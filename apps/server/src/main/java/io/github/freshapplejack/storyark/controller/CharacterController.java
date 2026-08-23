package io.github.freshapplejack.storyark.controller;

import cdut.s5g2.storyark_sprint5_backend.entity.Character;
import cdut.s5g2.storyark_sprint5_backend.mapper.CharacterMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

@RestController
@RequestMapping("/api/books/{bookId}/characters")
@CrossOrigin(origins = "http://localhost:3000", allowCredentials = "true")
public class CharacterController {

    @Autowired
    private CharacterMapper characterMapper;

    private final ObjectMapper objectMapper = new ObjectMapper();

    // 1. 获取所有角色
    @GetMapping
    public List<Map<String, Object>> getCharacters(@PathVariable Long bookId) {
        List<Character> characters = characterMapper.findByBookId(bookId);
        List<Map<String, Object>> result = new ArrayList<>();

        for (Character c : characters) {
            result.add(convertToDto(c));
        }
        return result;
    }

    // 2. 创建角色
    @PostMapping
    public Map<String, Object> createCharacter(@PathVariable Long bookId, @RequestBody Map<String, Object> payload) {
        Character character = convertToEntity(payload);
        character.setBookId(bookId);

        requireCharacterName(character.getName());
        if (character.getColor() == null) character.setColor("#3b82f6");
        if (character.getRole() == null) character.setRole("supporting");
        if (character.getTags() == null) character.setTags("[]");
        if (character.getAliases() == null) character.setAliases("[]");

        if (character.getHandleConfig() == null) {
            character.setHandleConfig("{\"top\":\"target\",\"right\":\"source\",\"bottom\":\"source\",\"left\":\"target\"}");
        }

        character.setOrderIndex(9999);

        characterMapper.insert(character);
        return convertToDto(character);
    }

    // 3. 更新角色
    @PutMapping("/{charId}")
    public Map<String, Object> updateCharacter(@PathVariable Long bookId, @PathVariable Long charId, @RequestBody Map<String, Object> payload) {
        Character character = convertToEntity(payload);
        character.setId(charId);
        character.setBookId(bookId);
        if (payload.containsKey("name")) {
            requireCharacterName(character.getName());
        }

        characterMapper.update(character);
        return convertToDto(character);
    }

    // 新增：批量更新角色 (用于在图谱页面点击保存时，批量保存所有节点的 Handle 配置和位置)
    @PostMapping("/batch")
    @Transactional
    public String updateCharactersBatch(@PathVariable Long bookId, @RequestBody List<Map<String, Object>> payloads) {
        for (Map<String, Object> payload : payloads) {
            Long id = ((Number) payload.get("id")).longValue();
            Character character = convertToEntity(payload);
            character.setId(id);
            character.setBookId(bookId);
            // 这里会调用包含 position 更新的 Mapper
            characterMapper.update(character);
        }
        return "Batch update successful";
    }

    @PostMapping("/reorder")
    @Transactional
    public String reorderCharacters(@PathVariable Long bookId, @RequestBody List<Long> charIds) {
        for (int i = 0; i < charIds.size(); i++) {
            Character c = new Character();
            c.setId(charIds.get(i));
            c.setOrderIndex(i);
            characterMapper.updateOrder(c);
        }
        return "Characters reordered successfully";
    }

    @DeleteMapping("/{charId}")
    public String deleteCharacter(@PathVariable Long bookId, @PathVariable Long charId) {
        characterMapper.deleteById(charId);
        return "Character deleted successfully";
    }

    // --- 辅助方法 ---

    private Map<String, Object> convertToDto(Character c) {
        Map<String, Object> map = objectMapper.convertValue(c, new TypeReference<Map<String, Object>>() {});

        try {
            if (c.getTags() != null && !c.getTags().isEmpty()) {
                List<String> tagsList = objectMapper.readValue(c.getTags(), new TypeReference<List<String>>() {});
                map.put("tags", tagsList);
            } else {
                map.put("tags", new ArrayList<>());
            }
        } catch (JsonProcessingException e) {
            map.put("tags", new ArrayList<>());
        }

        try {
            if (c.getAliases() != null && !c.getAliases().isEmpty()) {
                List<String> aliasesList = objectMapper.readValue(c.getAliases(), new TypeReference<List<String>>() {});
                map.put("aliases", aliasesList);
            } else {
                map.put("aliases", new ArrayList<>());
            }
        } catch (JsonProcessingException e) {
            map.put("aliases", new ArrayList<>());
        }

        try {
            if (c.getHandleConfig() != null && !c.getHandleConfig().isEmpty()) {
                Map<String, Object> config = objectMapper.readValue(c.getHandleConfig(), new TypeReference<Map<String, Object>>() {});
                map.put("handleConfig", config);
            }
        } catch (JsonProcessingException e) {
            e.printStackTrace();
        }

        // 确保 positionX 和 positionY 被包含在返回结果中 (objectMapper.convertValue 应该会自动处理，但为了保险)
        map.put("positionX", c.getPositionX());
        map.put("positionY", c.getPositionY());

        return map;
    }

    private Character convertToEntity(Map<String, Object> payload) {
        Character c = new Character();
        c.setName(sanitizeString(payload.get("name")));
        c.setRole((String) payload.get("role"));
        c.setDescription((String) payload.get("description"));
        c.setAvatar((String) payload.get("avatar"));
        c.setColor((String) payload.get("color"));

        if (payload.containsKey("orderIndex")) {
            c.setOrderIndex((Integer) payload.get("orderIndex"));
        }

        // 处理位置坐标
        if (payload.containsKey("positionX") && payload.get("positionX") != null) {
            c.setPositionX(((Number) payload.get("positionX")).doubleValue());
        }
        if (payload.containsKey("positionY") && payload.get("positionY") != null) {
            c.setPositionY(((Number) payload.get("positionY")).doubleValue());
        }

        if (payload.containsKey("tags")) {
            c.setTags(writeStringListJson(payload.get("tags")));
        }

        if (payload.containsKey("aliases")) {
            List<String> aliases = normalizeAliases(payload.get("aliases"), c.getName());
            c.setAliases(writeStringListJson(aliases));
        }

        Object configObj = payload.get("handleConfig");
        if (configObj != null) {
            try {
                String configJson = objectMapper.writeValueAsString(configObj);
                c.setHandleConfig(configJson);
            } catch (JsonProcessingException e) {
                e.printStackTrace();
            }
        }

        return c;
    }

    private String writeStringListJson(Object value) {
        try {
            if (value instanceof List<?> list) {
                List<String> strings = new ArrayList<>();
                for (Object item : list) {
                    if (item instanceof String stringItem) {
                        String trimmed = stringItem.trim();
                        if (!trimmed.isEmpty()) strings.add(trimmed);
                    }
                }
                return objectMapper.writeValueAsString(strings);
            }
            if (value instanceof String stringValue) {
                List<String> parsed = objectMapper.readValue(stringValue, new TypeReference<List<String>>() {});
                return writeStringListJson(parsed);
            }
        } catch (JsonProcessingException ignored) {
            // Fall through to an empty list for malformed array input.
        }
        return "[]";
    }

    private List<String> normalizeAliases(Object aliasesObj, String primaryName) {
        List<String> rawAliases = new ArrayList<>();
        if (aliasesObj instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof String stringItem) {
                    rawAliases.add(stringItem);
                }
            }
        } else if (aliasesObj instanceof String stringValue) {
            try {
                rawAliases = objectMapper.readValue(stringValue, new TypeReference<List<String>>() {});
            } catch (JsonProcessingException ignored) {
                rawAliases = new ArrayList<>();
            }
        }

        String primary = primaryName == null ? "" : primaryName.trim();
        Set<String> seen = new LinkedHashSet<>();
        for (String alias : rawAliases) {
            if (alias == null) continue;
            String trimmed = alias.trim();
            if (trimmed.isEmpty() || trimmed.equals(primary)) continue;
            seen.add(trimmed);
            if (seen.size() >= 3) break;
        }
        return new ArrayList<>(seen);
    }

    private String sanitizeString(Object value) {
        if (!(value instanceof String stringValue)) {
            return null;
        }
        return stringValue.trim();
    }

    private void requireCharacterName(String name) {
        if (name == null || name.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Character name cannot be empty");
        }
    }
}
