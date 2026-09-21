use super::chunking::CHUNK_INDEX_VERSION;
use super::lexical::LEXICAL_NORMALIZATION_VERSION;
use fastembed::{
    InitOptionsUserDefined, Pooling, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel,
};
use serde::Serialize;
use std::{
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

#[derive(Clone, Default)]
pub struct EmbeddingRuntime(Arc<Mutex<EmbeddingRuntimeState>>);

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
    pub fn status(&self) -> EmbeddingStatus {
        let mut state = self.0.lock().expect("embedding runtime lock poisoned");
        if let Some(status) = &state.status {
            return status.clone();
        }
        let status = match configured_model_dir() {
            Some(directory) if model_resources_exist(&directory) => {
                match LocalFastEmbedProvider::load(&directory) {
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
                "The configured local embedding model resources are incomplete".to_owned(),
            ),
            None => EmbeddingStatus::unavailable(
                "MODEL_NOT_CONFIGURED",
                "Set STORYARK_EMBEDDING_MODEL_DIR to the local model directory".to_owned(),
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
            .0
            .lock()
            .map_err(|_| "Embedding runtime unavailable".to_owned())?;
        if state.provider.is_none() {
            let directory = configured_model_dir().ok_or_else(|| {
                "Local embedding model is not configured; lexical search remains available"
                    .to_owned()
            })?;
            let provider = LocalFastEmbedProvider::load(&directory)?;
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

pub fn configured_model_dir() -> Option<PathBuf> {
    if let Some(value) =
        std::env::var_os("STORYARK_EMBEDDING_MODEL_DIR").filter(|value| !value.is_empty())
    {
        return Some(PathBuf::from(value));
    }

    if !cfg!(debug_assertions) {
        return None;
    }

    ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
        .iter()
        .filter_map(|name| std::env::var_os(name).filter(|value| !value.is_empty()))
        .map(|root| {
            PathBuf::from(root)
                .join("StoryArk_OutsideDocs")
                .join("Embedding_Model")
                .join("multilingual-e5-small")
        })
        .find(|directory| directory.is_dir())
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
    Ok(())
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
