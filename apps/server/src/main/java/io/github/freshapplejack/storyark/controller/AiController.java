package io.github.freshapplejack.storyark.controller;

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
@RequestMapping("/api/ai")
@CrossOrigin(origins = "http://localhost:3000", allowCredentials = "true")
public class AiController {

    private static final int DEFAULT_OUTPUT_LENGTH_CHARS = 300;
    private static final int MIN_OUTPUT_LENGTH_CHARS = 120;
    private static final int MAX_OUTPUT_LENGTH_CHARS = 800;

    @Value("${deepseek.api.key}")
    private String apiKey;

    @Value("${deepseek.api.url}")
    private String apiUrl;

    @Value("${deepseek.api.model:deepseek-v4-flash}")
    private String model;

    private final RestTemplate restTemplate = new RestTemplate();

    @PostMapping("/continue")
    public Map<String, String> continueStory(@RequestBody Map<String, Object> request) {

        Object rawContent = request.get("content");
        String previousContent = rawContent == null ? "" : String.valueOf(rawContent);
        int outputLengthChars = clamp(readInteger(request.get("outputLengthChars"), DEFAULT_OUTPUT_LENGTH_CHARS), MIN_OUTPUT_LENGTH_CHARS, MAX_OUTPUT_LENGTH_CHARS);
        int lowerOutputLengthChars = Math.max(MIN_OUTPUT_LENGTH_CHARS, (int) Math.floor(outputLengthChars * 2.0 / 3.0));
        String targetLengthText = lowerOutputLengthChars == outputLengthChars
                ? "约" + outputLengthChars + "字"
                : "约" + lowerOutputLengthChars + "-" + outputLengthChars + "字";

        // 1. create request headers
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("Authorization", "Bearer " + apiKey);

        // 2. generate request body (OpenAI-compatible DeepSeek API)
        Map<String, Object> body = new HashMap<>();
        body.put("model", model);
        body.put("thinking", Map.of("type", "disabled"));
        body.put("max_tokens", Math.max(256, outputLengthChars * 2));

        // generate message history
        List<Map<String, String>> messages = new ArrayList<>();
        // System Prompt: set AI's character
        messages.add(Map.of("role", "system", "content", "你是一个专业的网络小说作家。请根据用户提供的前文，续写一段" + targetLengthText + "的剧情。风格要连贯，情节要吸引人。只返回续写的内容，不要有任何多余的废话。"));
        // User Prompt: set user input
        messages.add(Map.of("role", "user", "content", previousContent));

        body.put("messages", messages);

        // 3. send request to DeepSeek API
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(apiUrl, entity, Map.class);

            // 4. parse response body (JSON Path: choices[0].message.content)
            Map<String, Object> responseBody = response.getBody();
            List<Map<String, Object>> choices = (List<Map<String, Object>>) responseBody.get("choices");
            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            String aiContent = (String) message.get("content");

            return Map.of("result", aiContent);

        } catch (Exception e) {
            e.printStackTrace();
            throw new RuntimeException("AI Service Error: " + e.getMessage());
        }
    }

    private int readInteger(Object value, int fallback) {
        if (value instanceof Number numberValue) {
            return numberValue.intValue();
        }
        if (value instanceof String stringValue) {
            try {
                return Integer.parseInt(stringValue);
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private int clamp(int value, int min, int max) {
        return Math.min(max, Math.max(min, value));
    }
}
