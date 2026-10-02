use super::chunking::CHUNK_INDEX_VERSION;
use super::lexical::LEXICAL_NORMALIZATION_VERSION;
use fastembed::{
    InitOptionsUserDefined, Pooling, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub const PROVIDER_ID: &str = "fastembed-rs";
pub const CONFIG_ID: &str = "local-multilingual-e5-small";
pub const MODEL_ID: &str = "intfloat/multilingual-e5-small";
pub const DIMENSION: usize = 384;
pub const MAX_INPUT_LENGTH: usize = 512;
pub const DOCUMENT_PREFIX: &str = "passage: ";
pub const QUERY_PREFIX: &str = "query: ";
pub const POOLING: &str = "mean";
pub const NORMALIZATION: &str = "l2";
pub const BUNDLED_MODEL_RESOURCE_PATH: &str = "resources/embedding/multilingual-e5-small";

const MODEL_RESOURCE_SHA256: [(&str, &str); 5] = [
    (
        "config.json",
        "69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959",
    ),
    (
        "tokenizer.json",
        "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
    ),
    (
        "special_tokens_map.json",
        "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
    ),
    (
        "tokenizer_config.json",
        "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
    ),
    (
        "onnx/model.onnx",
        "ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665",
    ),
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingFingerprint {
    pub provider_id: String,
    pub config_id: String,
    pub model_id: String,
    pub dimension: usize,
    pub pooling: String,
    pub normalization: String,
    pub query_prefix: String,
    pub document_prefix: String,
    pub max_input_length: usize,
    pub chunk_version: i64,
    pub normalization_version: i64,
}

impl EmbeddingFingerprint {
    pub fn current() -> Self {
        Self {
            provider_id: PROVIDER_ID.to_owned(),
            config_id: CONFIG_ID.to_owned(),
            model_id: MODEL_ID.to_owned(),
            dimension: DIMENSION,
            pooling: POOLING.to_owned(),
            normalization: NORMALIZATION.to_owned(),
            query_prefix: QUERY_PREFIX.to_owned(),
            document_prefix: DOCUMENT_PREFIX.to_owned(),
            max_input_length: MAX_INPUT_LENGTH,
            chunk_version: CHUNK_INDEX_VERSION,
            normalization_version: LEXICAL_NORMALIZATION_VERSION,
        }
    }

    pub fn stable_string(&self) -> String {
        serde_json::to_string(self).expect("embedding fingerprint is serializable")
    }
}

pub trait EmbeddingProvider: Send {
    fn fingerprint(&self) -> &str;
    fn embed_documents(&mut self, texts: &[String]) -> Result<Vec<Vec<f32>>, String>;
    fn embed_query(&mut self, text: &str) -> Result<Vec<f32>, String>;
}

struct LocalFastEmbedProvider {
    model: TextEmbedding,
    fingerprint: String,
}

impl LocalFastEmbedProvider {
    fn load(model_dir: &Path) -> Result<Self, String> {
        validate_model_resources(model_dir)?;
        let tokenizer_files = TokenizerFiles {
            tokenizer_file: read_model_file(model_dir, "tokenizer.json")?,
            config_file: read_model_file(model_dir, "config.json")?,
            special_tokens_map_file: read_model_file(model_dir, "special_tokens_map.json")?,
            tokenizer_config_file: read_model_file(model_dir, "tokenizer_config.json")?,
        };
        validate_model_config(
            &tokenizer_files.config_file,
            &tokenizer_files.tokenizer_config_file,
        )?;
        let model_bytes = read_model_file(model_dir, "onnx/model.onnx")?;
        let model = UserDefinedEmbeddingModel::new(model_bytes, tokenizer_files)
            .with_pooling(Pooling::Mean);
        let threads = std::env::var("STORYARK_EMBEDDING_THREADS")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .filter(|value| (1..=64).contains(value))
            .unwrap_or_else(|| {
                std::thread::available_parallelism()
                    .map(|value| value.get().min(4))
                    .unwrap_or(1)
            });
        let model = TextEmbedding::try_new_from_user_defined(
            model,
            InitOptionsUserDefined::new()
                .with_max_length(MAX_INPUT_LENGTH)
                .with_intra_threads(threads),
        )
        .map_err(|error| format!("Local embedding model could not be loaded: {error}"))?;
        Ok(Self {
            model,
            fingerprint: EmbeddingFingerprint::current().stable_string(),
        })
    }

    fn normalize_output(vector: Vec<f32>) -> Result<Vec<f32>, String> {
        if vector.len() != DIMENSION {
            return Err(format!(
                "Embedding output dimension was {}, expected {DIMENSION}",
                vector.len()
            ));
        }
        let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
        if !norm.is_finite() || norm <= f32::EPSILON {
            return Err("Embedding output was empty or non-finite".to_owned());
        }
        let normalized = vector
            .into_iter()
            .map(|value| value / norm)
            .collect::<Vec<_>>();
        let check = normalized
            .iter()
            .map(|value| value * value)
            .sum::<f32>()
            .sqrt();
        if (check - 1.0).abs() > 0.01 {
            return Err("Embedding output could not be normalized".to_owned());
        }
        Ok(normalized)
    }
}

impl EmbeddingProvider for LocalFastEmbedProvider {
    fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    fn embed_documents(&mut self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let inputs = texts
            .iter()
            .map(|text| format!("{DOCUMENT_PREFIX}{text}"))
            .collect::<Vec<_>>();
        self.model
            .embed(inputs, None)
            .map_err(|error| format!("Local document embedding failed: {error}"))?
            .into_iter()
            .map(Self::normalize_output)
            .collect()
    }

    fn embed_query(&mut self, text: &str) -> Result<Vec<f32>, String> {
        let inputs = vec![format!("{QUERY_PREFIX}{text}")];
        let mut outputs = self
            .model
            .embed(inputs, None)
            .map_err(|error| format!("Local query embedding failed: {error}"))?;
        let vector = outputs
            .pop()
            .ok_or_else(|| "Local query embedding returned no vector".to_owned())?;
        Self::normalize_output(vector)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingStatus {
    pub available: bool,
    pub provider_id: Option<String>,
    pub config_id: Option<String>,
    pub model_id: Option<String>,
    pub dimension: Option<usize>,
    pub max_input_length: Option<usize>,
    pub fingerprint: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl EmbeddingStatus {
    fn unavailable(code: &str, message: String) -> Self {
        Self {
            available: false,
            provider_id: Some(PROVIDER_ID.to_owned()),
            config_id: Some(CONFIG_ID.to_owned()),
            model_id: Some(MODEL_ID.to_owned()),
            dimension: Some(DIMENSION),
            max_input_length: Some(MAX_INPUT_LENGTH),
            fingerprint: None,
            error_code: Some(code.to_owned()),
            error_message: Some(message),
        }
    }

    fn available(fingerprint: String) -> Self {
        Self {
            available: true,
            provider_id: Some(PROVIDER_ID.to_owned()),
            config_id: Some(CONFIG_ID.to_owned()),
            model_id: Some(MODEL_ID.to_owned()),
            dimension: Some(DIMENSION),
            max_input_length: Some(MAX_INPUT_LENGTH),
            fingerprint: Some(fingerprint),
            error_code: None,
            error_message: None,
        }
    }
}

#[derive(Clone)]
pub struct EmbeddingRuntime {
    state: Arc<Mutex<EmbeddingRuntimeState>>,
    queries_waiting: Arc<std::sync::atomic::AtomicUsize>,
    model_dir: Option<PathBuf>,
}

struct EmbeddingRuntimeState {
    provider: Option<LocalFastEmbedProvider>,
    status: Option<EmbeddingStatus>,
}

impl Default for EmbeddingRuntimeState {
    fn default() -> Self {
        Self {
            provider: None,
            status: None,
        }
    }
}

impl EmbeddingRuntime {
    pub fn with_model_dir(model_dir: Option<PathBuf>) -> Self {
        Self {
            state: Arc::default(),
            queries_waiting: Arc::default(),
            model_dir,
        }
    }

    pub fn queries_waiting(&self) -> bool {
        self.queries_waiting
            .load(std::sync::atomic::Ordering::SeqCst)
            > 0
    }

    pub fn query(&self, text: &str) -> Result<Vec<f32>, String> {
        self.queries_waiting
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let result = self.with_provider(|provider| provider.embed_query(text));
        self.queries_waiting
            .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        result
    }
    pub fn status(&self) -> EmbeddingStatus {
        let mut state = self.state.lock().expect("embedding runtime lock poisoned");
        if let Some(status) = &state.status {
            return status.clone();
        }
        let status = match self.model_dir.as_deref() {
            Some(directory) if model_resources_exist(directory) => {
                match LocalFastEmbedProvider::load(directory) {
                    Ok(provider) => {
                        let fingerprint = provider.fingerprint.clone();
                        state.provider = Some(provider);
                        EmbeddingStatus::available(fingerprint)
                    }
                    Err(error) => EmbeddingStatus::unavailable("MODEL_LOAD_FAILED", error),
                }
            }
            Some(_) => EmbeddingStatus::unavailable(
                "MODEL_INCOMPLETE",
                "The bundled local embedding model resources are missing or failed integrity checks".to_owned(),
            ),
            None => EmbeddingStatus::unavailable(
                "MODEL_RESOURCE_UNAVAILABLE",
                "The bundled local embedding model resource could not be located".to_owned(),
            ),
        };
        state.status = Some(status.clone());
        status
    }

    pub fn with_provider<T>(
        &self,
        operation: impl FnOnce(&mut dyn EmbeddingProvider) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Embedding runtime unavailable".to_owned())?;
        if state.provider.is_none() {
            let directory = self.model_dir.as_deref().ok_or_else(|| {
                "Bundled local embedding model resource is unavailable; lexical search remains available"
                    .to_owned()
            })?;
            let provider = LocalFastEmbedProvider::load(directory)?;
            state.status = Some(EmbeddingStatus::available(provider.fingerprint.clone()));
            state.provider = Some(provider);
        }
        operation(state.provider.as_mut().expect("provider was initialized"))
    }
}

pub fn current_fingerprint() -> String {
    EmbeddingFingerprint::current().stable_string()
}

pub fn encode_vector(vector: &[f32]) -> Result<Vec<u8>, String> {
    if vector.len() != DIMENSION {
        return Err(format!(
            "Embedding vector dimension was {}, expected {DIMENSION}",
            vector.len()
        ));
    }
    let mut output = Vec::with_capacity(vector.len() * std::mem::size_of::<f32>());
    for value in vector {
        output.extend_from_slice(&value.to_le_bytes());
    }
    Ok(output)
}

pub fn decode_vector(blob: &[u8]) -> Result<Vec<f32>, String> {
    if blob.len() != DIMENSION * std::mem::size_of::<f32>() {
        return Err("Stored embedding vector has an invalid size".to_owned());
    }
    Ok(blob
        .chunks_exact(std::mem::size_of::<f32>())
        .map(|chunk| f32::from_le_bytes(chunk.try_into().expect("fixed-size vector chunk")))
        .collect())
}

pub fn dot(left: &[f32], right: &[f32]) -> f32 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

pub fn development_model_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(BUNDLED_MODEL_RESOURCE_PATH)
}

fn model_resources_exist(directory: &Path) -> bool {
    [
        "config.json",
        "tokenizer.json",
        "special_tokens_map.json",
        "tokenizer_config.json",
        "onnx/model.onnx",
    ]
    .iter()
    .all(|relative| directory.join(relative).is_file())
}

fn validate_model_resources(directory: &Path) -> Result<(), String> {
    if !directory.is_dir() {
        return Err("Local embedding model directory does not exist".to_owned());
    }
    if !model_resources_exist(directory) {
        return Err("Local embedding model resources are incomplete".to_owned());
    }
    for (relative_path, expected_hash) in MODEL_RESOURCE_SHA256 {
        let actual_hash = sha256_file(&directory.join(relative_path))?;
        if actual_hash != expected_hash {
            return Err(format!(
                "Local embedding resource failed SHA-256 verification: {relative_path}"
            ));
        }
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|_| "Unable to read a local embedding model resource".to_owned())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "Unable to verify a local embedding model resource".to_owned())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn read_model_file(directory: &Path, relative: &str) -> Result<Vec<u8>, String> {
    std::fs::read(directory.join(relative))
        .map_err(|_| format!("Unable to read local embedding resource {relative}"))
}

fn validate_model_config(config: &[u8], tokenizer_config: &[u8]) -> Result<(), String> {
    let config: serde_json::Value =
        serde_json::from_slice(config).map_err(|_| "Invalid embedding config.json".to_owned())?;
    if config.get("hidden_size").and_then(|value| value.as_u64()) != Some(DIMENSION as u64) {
        return Err("The local embedding model hidden size is not 384".to_owned());
    }
    let tokenizer_config: serde_json::Value = serde_json::from_slice(tokenizer_config)
        .map_err(|_| "Invalid embedding tokenizer_config.json".to_owned())?;
    if tokenizer_config
        .get("model_max_length")
        .and_then(|value| value.as_u64())
        .map_or(true, |value| value < MAX_INPUT_LENGTH as u64)
    {
        return Err("The local embedding tokenizer max length is below 512".to_owned());
    }
    Ok(())
}
