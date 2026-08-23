package io.github.freshapplejack.storyark.controller;

import cdut.s5g2.storyark_sprint5_backend.entity.AiBrainstorm;
import cdut.s5g2.storyark_sprint5_backend.mapper.AiBrainstormMapper;
import cdut.s5g2.storyark_sprint5_backend.mapper.BookMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/books/{bookId}/brainstorm")
@CrossOrigin(origins = "http://localhost:3000", allowCredentials = "true")
public class AiBrainstormController {

    private static final int MAX_STORY_FIELD_CHARS = 1200;
    private static final int MAX_CHAPTER_SUMMARY_CHARS = 500;
    private static final int MAX_CHARACTER_NOTE_CHARS = 600;

    @Value("${deepseek.api.key}")
    private String apiKey;

    @Value("${deepseek.api.url}")
    private String apiUrl;

    @Value("${deepseek.api.model:deepseek-v4-flash}")
    private String model;

    @Autowired
    private AiBrainstormMapper aiBrainstormMapper;

    @Autowired
    private BookMapper bookMapper;

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @GetMapping
    public AiBrainstorm getBrainstorm(@PathVariable Long bookId) {
        AiBrainstorm brainstorm = aiBrainstormMapper.findByBookId(bookId);
        if (brainstorm != null) {
            return brainstorm;
        }

        AiBrainstorm empty = new AiBrainstorm();
        empty.setBookId(bookId);
        empty.setSelectedChapterIds("[]");
        empty.setContextSnapshot("{}");
        empty.setGeneratedOptions("[]");
        empty.setSelectedOptionId(null);
        empty.setFinalContent("");
        return empty;
    }

    @PutMapping
    public AiBrainstorm saveBrainstorm(@PathVariable Long bookId, @RequestBody AiBrainstorm brainstorm) {
        normalizeBrainstorm(bookId, brainstorm);
        aiBrainstormMapper.upsert(brainstorm);
        bookMapper.updateTime(bookId);
        return aiBrainstormMapper.findByBookId(bookId);
    }

    @PostMapping("/generate")
    public AiBrainstorm generateBrainstorm(@PathVariable Long bookId, @RequestBody Map<String, Object> payload) {
        AiBrainstorm brainstorm = new AiBrainstorm();
        brainstorm.setBookId(bookId);
        brainstorm.setSelectedChapterIds(toJson(payload.get("selectedChapterIds"), "[]"));
        brainstorm.setContextSnapshot(toJson(payload.get("contextSnapshot"), "{}"));
        brainstorm.setSelectedOptionId(null);
        brainstorm.setFinalContent("");

        List<Map<String, Object>> options = requestBrainstormOptions(brainstorm.getContextSnapshot());
        brainstorm.setGeneratedOptions(toJson(options, "[]"));

        aiBrainstormMapper.upsert(brainstorm);
        bookMapper.updateTime(bookId);
        return aiBrainstormMapper.findByBookId(bookId);
    }

    private void normalizeBrainstorm(Long bookId, AiBrainstorm brainstorm) {
        brainstorm.setBookId(bookId);
        if (brainstorm.getSelectedChapterIds() == null) {
            brainstorm.setSelectedChapterIds("[]");
        }
        if (brainstorm.getContextSnapshot() == null) {
            brainstorm.setContextSnapshot("{}");
        }
        if (brainstorm.getGeneratedOptions() == null) {
            brainstorm.setGeneratedOptions("[]");
        }
        if (brainstorm.getFinalContent() == null) {
            brainstorm.setFinalContent("");
        }
    }

    private List<Map<String, Object>> requestBrainstormOptions(String contextSnapshotJson) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("Authorization", "Bearer " + apiKey);

        Map<String, Object> body = new HashMap<>();
        body.put("model", model);
        body.put("thinking", Map.of("type", "disabled"));
        body.put("response_format", Map.of("type", "json_object"));

        List<Map<String, String>> messages = new ArrayList<>();
        messages.add(Map.of(
                "role", "system",
                "content",
                """
                You are a senior web-novel story architect. Generate exactly three alternative next-plot directions.
                Use only the provided story synopsis, background, selected chapter summaries, appearing characters, and character relationships.
                Return only valid JSON with this exact shape:
                {"options":[{"id":"option-1","title":"","conflict":"","motivation":"","consequences":"","development":""},{"id":"option-2","title":"","conflict":"","motivation":"","consequences":"","development":""},{"id":"option-3","title":"","conflict":"","motivation":"","consequences":"","development":""}]}
                Requirements:
                - title: short and concrete.
                - conflict: 2-3 sentences explaining the main conflict, plot hook, and immediate pressure.
                - motivation: 2-3 sentences explaining why the involved characters act this way, grounded in their tags and notes.
                - consequences: 2-3 sentences covering immediate fallout, future impact, and risks.
                - development: 5-7 concrete continuation beats the writer can edit and save; include setup, escalation, reveal, decision, and next-chapter landing point.
                - Stay consistent with the existing setting and character notes.
                - Do not include markdown, commentary, or extra keys.
                """
        ));
        messages.add(Map.of(
                "role", "user",
                "content",
                buildPlainTextContext(contextSnapshotJson)
        ));
        body.put("messages", messages);

        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(apiUrl, new HttpEntity<>(body, headers), Map.class);
            Map<String, Object> responseBody = response.getBody();
            List<Map<String, Object>> choices = (List<Map<String, Object>>) responseBody.get("choices");
            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            String aiContent = (String) message.get("content");
            return normalizeOptions(parseOptions(aiContent));
        } catch (Exception e) {
            e.printStackTrace();
            throw new RuntimeException("AI Brainstorm Service Error: " + e.getMessage());
        }
    }

    private List<Map<String, Object>> parseOptions(String aiContent) throws JsonProcessingException {
        String json = extractJsonObject(aiContent == null ? "" : aiContent.trim());
        Map<String, Object> parsed = objectMapper.readValue(json, new TypeReference<>() {});
        Object options = parsed.get("options");
        if (!(options instanceof List<?> rawOptions)) {
            throw new RuntimeException("AI response does not contain options");
        }

        List<Map<String, Object>> normalized = new ArrayList<>();
        for (Object item : rawOptions) {
            if (item instanceof Map<?, ?> rawMap) {
                Map<String, Object> option = new HashMap<>();
                rawMap.forEach((key, value) -> option.put(String.valueOf(key), value));
                normalized.add(option);
            }
        }
        return normalized;
    }

    private List<Map<String, Object>> normalizeOptions(List<Map<String, Object>> options) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (int i = 0; i < Math.min(3, options.size()); i++) {
            Map<String, Object> raw = options.get(i);
            Map<String, Object> option = new HashMap<>();
            option.put("id", stringOrDefault(raw.get("id"), "option-" + (i + 1)));
            option.put("title", stringOrDefault(raw.get("title"), "Plot Direction " + (i + 1)));
            option.put("conflict", stringOrDefault(raw.get("conflict"), ""));
            option.put("motivation", stringOrDefault(raw.get("motivation"), ""));
            option.put("consequences", stringOrDefault(raw.get("consequences"), ""));
            option.put("development", stringOrDefault(raw.get("development"), ""));
            result.add(option);
        }
        if (result.size() != 3) {
            throw new RuntimeException("AI response must contain exactly three options");
        }
        return result;
    }

    private String extractJsonObject(String content) {
        int start = content.indexOf('{');
        int end = content.lastIndexOf('}');
        if (start < 0 || end <= start) {
            throw new RuntimeException("AI response is not valid JSON");
        }
        return content.substring(start, end + 1);
    }

    private String stringOrDefault(Object value, String fallback) {
        if (value == null) return fallback;
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? fallback : text;
    }

    private String buildPlainTextContext(String contextSnapshotJson) {
        Map<String, Object> context;
        try {
            context = objectMapper.readValue(contextSnapshotJson, new TypeReference<>() {});
        } catch (JsonProcessingException e) {
            return "Story Context:\n" + compact(contextSnapshotJson, 6000);
        }

        StringBuilder prompt = new StringBuilder();
        appendSection(prompt, "Book Title", stringOrDefault(context.get("bookTitle"), ""));
        appendSection(prompt, "Story Synopsis", compact(context.get("storySummary"), MAX_STORY_FIELD_CHARS));
        appendSection(prompt, "Story Background", compact(context.get("storyBackground"), MAX_STORY_FIELD_CHARS));

        Object selectedChapters = context.get("selectedChapters");
        if (selectedChapters instanceof List<?> chapters && !chapters.isEmpty()) {
            prompt.append("\nSelected Chapters:\n");
            for (int i = 0; i < chapters.size(); i++) {
                if (!(chapters.get(i) instanceof Map<?, ?> chapter)) continue;
                prompt.append(i + 1).append(". ")
                        .append(stringOrDefault(chapter.get("volumeTitle"), ""))
                        .append(" / ")
                        .append(stringOrDefault(chapter.get("title"), "Untitled"))
                        .append("\n");
                appendIndented(prompt, "Summary", compact(chapter.get("summary"), MAX_CHAPTER_SUMMARY_CHARS));
            }
        }

        Object missingSummaryTitles = context.get("missingSummaryChapterTitles");
        if (missingSummaryTitles instanceof List<?> missing && !missing.isEmpty()) {
            appendSection(prompt, "Chapters Missing Summary", joinList(missing));
        }

        Object appearingCharacters = context.get("appearingCharacters");
        if (appearingCharacters instanceof List<?> characters && !characters.isEmpty()) {
            prompt.append("\nAppearing Characters:\n");
            for (Object item : characters) {
                if (!(item instanceof Map<?, ?> character)) continue;
                prompt.append("- ")
                        .append(stringOrDefault(character.get("name"), "Unknown"))
                        .append(" (")
                        .append(stringOrDefault(character.get("role"), ""))
                        .append(")");
                String tags = joinList(character.get("tags"));
                if (!tags.isBlank()) {
                    prompt.append(" Tags: ").append(tags);
                }
                prompt.append("\n");
                appendIndented(prompt, "Notes", compact(character.get("biographyAndNotes"), MAX_CHARACTER_NOTE_CHARS));
            }
        }

        Object relationships = context.get("relationships");
        if (relationships instanceof List<?> relationList && !relationList.isEmpty()) {
            prompt.append("\nRelationships:\n");
            for (Object item : relationList) {
                if (!(item instanceof Map<?, ?> relationship)) continue;
                prompt.append("- ")
                        .append(stringOrDefault(relationship.get("source"), "Unknown"))
                        .append(" -> ")
                        .append(stringOrDefault(relationship.get("target"), "Unknown"));
                String label = stringOrDefault(relationship.get("label"), "");
                if (!label.isBlank()) {
                    prompt.append(": ").append(label);
                }
                prompt.append("\n");
            }
        }

        appendSection(prompt, "Output Goal", stringOrDefault(
                context.get("outputGoal"),
                "Give three alternative next-plot directions with conflict hook, character motivation, consequences, and a development plan."
        ));

        return prompt.toString().trim();
    }

    private void appendSection(StringBuilder builder, String title, String value) {
        if (value == null || value.isBlank()) return;
        builder.append("\n").append(title).append(":\n").append(value).append("\n");
    }

    private void appendIndented(StringBuilder builder, String label, String value) {
        if (value == null || value.isBlank()) return;
        builder.append("   ").append(label).append(": ").append(value).append("\n");
    }

    private String compact(Object value, int maxChars) {
        if (value == null) return "";
        String text = String.valueOf(value)
                .replaceAll("[\\s\\u3000]+", " ")
                .trim();
        if (text.length() <= maxChars) return text;
        return text.substring(0, maxChars).trim() + "...";
    }

    private String joinList(Object value) {
        if (!(value instanceof List<?> list)) {
            return "";
        }
        return list.stream()
                .map(item -> String.valueOf(item).trim())
                .filter(text -> !text.isEmpty())
                .reduce((left, right) -> left + ", " + right)
                .orElse("");
    }

    private String toJson(Object value, String fallback) {
        if (value == null) {
            return fallback;
        }
        if (value instanceof String stringValue) {
            return stringValue;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            return fallback;
        }
    }
}
