package io.github.freshapplejack.storyark.controller;

import io.github.freshapplejack.storyark.entity.User;
import io.github.freshapplejack.storyark.entity.UserSettings;
import io.github.freshapplejack.storyark.mapper.UserSettingsMapper;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;

@RestController
@RequestMapping("/api/user-settings")
@CrossOrigin(origins = "http://localhost:3000", allowCredentials = "true")
public class UserSettingsController {

    private static final int DEFAULT_EDITOR_MARGIN_PX = 48;
    private static final int MIN_EDITOR_MARGIN_PX = 24;
    private static final int MAX_EDITOR_MARGIN_PX = 72;
    private static final BigDecimal DEFAULT_EDITOR_LINE_HEIGHT = new BigDecimal("1.50");
    private static final BigDecimal MIN_EDITOR_LINE_HEIGHT = new BigDecimal("1.20");
    private static final BigDecimal MAX_EDITOR_LINE_HEIGHT = new BigDecimal("1.80");
    private static final int DEFAULT_AI_CONTINUE_CONTEXT_CHARS = 2000;
    private static final int MIN_AI_CONTINUE_CONTEXT_CHARS = 500;
    private static final int MAX_AI_CONTINUE_CONTEXT_CHARS = 6000;
    private static final int DEFAULT_AI_CONTINUE_OUTPUT_CHARS = 300;
    private static final int MIN_AI_CONTINUE_OUTPUT_CHARS = 120;
    private static final int MAX_AI_CONTINUE_OUTPUT_CHARS = 800;
    private static final Set<String> CHARACTER_ROLES = Set.of("protagonist", "antagonist", "supporting", "mob");

    @Autowired
    private UserSettingsMapper userSettingsMapper;

    @GetMapping("/me")
    public UserSettings getMySettings(HttpSession session) {
        User loginUser = getLoginUser(session);
        return ensureSettings(loginUser.getId());
    }

    @PutMapping("/me/dark-mode")
    public UserSettings updateMyDarkMode(@RequestBody Map<String, Object> payload, HttpSession session) {
        User loginUser = getLoginUser(session);
        Object value = payload.get("darkMode");
        if (!(value instanceof Boolean)) {
            throw new RuntimeException("darkMode must be boolean");
        }

        UserSettings settings = ensureSettings(loginUser.getId());
        settings.setDarkMode((Boolean) value);
        userSettingsMapper.updateDarkMode(loginUser.getId(), settings.getDarkMode());
        return userSettingsMapper.findByUserId(loginUser.getId());
    }

    @PutMapping("/me/editor-spacing")
    public UserSettings updateMyEditorSpacing(@RequestBody Map<String, Object> payload, HttpSession session) {
        User loginUser = getLoginUser(session);
        Integer editorMarginPx = readInteger(payload.get("editorMarginPx"), "editorMarginPx");
        BigDecimal editorLineHeight = readDecimal(payload.get("editorLineHeight"), "editorLineHeight");

        UserSettings settings = ensureSettings(loginUser.getId());
        settings.setEditorMarginPx(clamp(editorMarginPx, MIN_EDITOR_MARGIN_PX, MAX_EDITOR_MARGIN_PX));
        settings.setEditorLineHeight(clamp(editorLineHeight, MIN_EDITOR_LINE_HEIGHT, MAX_EDITOR_LINE_HEIGHT).setScale(2, RoundingMode.HALF_UP));

        userSettingsMapper.updateEditorSpacing(loginUser.getId(), settings.getEditorMarginPx(), settings.getEditorLineHeight());
        return userSettingsMapper.findByUserId(loginUser.getId());
    }

    @PutMapping("/me/ai-continue")
    public UserSettings updateMyAiContinue(@RequestBody Map<String, Object> payload, HttpSession session) {
        User loginUser = getLoginUser(session);
        Integer aiContinueContextChars = readInteger(payload.get("aiContinueContextChars"), "aiContinueContextChars");
        Integer aiContinueOutputChars = readInteger(payload.get("aiContinueOutputChars"), "aiContinueOutputChars");

        UserSettings settings = ensureSettings(loginUser.getId());
        settings.setAiContinueContextChars(clamp(aiContinueContextChars, MIN_AI_CONTINUE_CONTEXT_CHARS, MAX_AI_CONTINUE_CONTEXT_CHARS));
        settings.setAiContinueOutputChars(clamp(aiContinueOutputChars, MIN_AI_CONTINUE_OUTPUT_CHARS, MAX_AI_CONTINUE_OUTPUT_CHARS));

        userSettingsMapper.updateAiContinue(loginUser.getId(), settings.getAiContinueContextChars(), settings.getAiContinueOutputChars());
        return userSettingsMapper.findByUserId(loginUser.getId());
    }

    @PutMapping("/me/auto-highlight")
    public UserSettings updateMyAutoHighlight(@RequestBody Map<String, Object> payload, HttpSession session) {
        User loginUser = getLoginUser(session);
        List<String> disabledRoles = readRoleList(payload.get("disabledRoles"), "disabledRoles");
        String disabledRolesJson = toJsonArray(disabledRoles);

        ensureSettings(loginUser.getId());
        userSettingsMapper.updateAutoHighlightTags(loginUser.getId(), disabledRolesJson);
        return userSettingsMapper.findByUserId(loginUser.getId());
    }

    private User getLoginUser(HttpSession session) {
        User loginUser = (User) session.getAttribute("loginUser");
        if (loginUser == null) {
            throw new RuntimeException("Please log in first!");
        }
        return loginUser;
    }

    private UserSettings ensureSettings(Long userId) {
        UserSettings settings = userSettingsMapper.findByUserId(userId);
        if (settings != null) {
            return settings;
        }

        UserSettings newSettings = new UserSettings();
        newSettings.setUserId(userId);
        newSettings.setDarkMode(false);
        newSettings.setEditorMarginPx(DEFAULT_EDITOR_MARGIN_PX);
        newSettings.setEditorLineHeight(DEFAULT_EDITOR_LINE_HEIGHT);
        newSettings.setEditorFontSizePx(18);
        newSettings.setEditorFontFamily("\"KaiTi\", \"STKaiti\", serif");
        newSettings.setAiContinueContextChars(DEFAULT_AI_CONTINUE_CONTEXT_CHARS);
        newSettings.setAiContinueOutputChars(DEFAULT_AI_CONTINUE_OUTPUT_CHARS);
        newSettings.setAutoHighlightEnabled(true);
        newSettings.setAutoHighlightTags("[]");
        userSettingsMapper.insert(newSettings);
        return userSettingsMapper.findByUserId(userId);
    }

    private Integer readInteger(Object value, String fieldName) {
        if (value instanceof Number numberValue) {
            return numberValue.intValue();
        }
        if (value instanceof String stringValue) {
            try {
                return Integer.parseInt(stringValue);
            } catch (NumberFormatException ignored) {
                throw new RuntimeException(fieldName + " must be a number");
            }
        }
        throw new RuntimeException(fieldName + " must be a number");
    }

    private BigDecimal readDecimal(Object value, String fieldName) {
        if (value instanceof Number || value instanceof String) {
            try {
                return new BigDecimal(value.toString());
            } catch (NumberFormatException ignored) {
                throw new RuntimeException(fieldName + " must be a decimal number");
            }
        }
        throw new RuntimeException(fieldName + " must be a decimal number");
    }

    private int clamp(int value, int min, int max) {
        return Math.min(max, Math.max(min, value));
    }

    private BigDecimal clamp(BigDecimal value, BigDecimal min, BigDecimal max) {
        if (value.compareTo(min) < 0) {
            return min;
        }
        if (value.compareTo(max) > 0) {
            return max;
        }
        return value;
    }

    private List<String> readRoleList(Object value, String fieldName) {
        if (!(value instanceof List<?> rawList)) {
            throw new RuntimeException(fieldName + " must be an array");
        }

        LinkedHashSet<String> roles = new LinkedHashSet<>();
        for (Object item : rawList) {
            if (!(item instanceof String role) || !CHARACTER_ROLES.contains(role)) {
                throw new RuntimeException("Invalid character role");
            }
            roles.add(role);
        }
        return new ArrayList<>(roles);
    }

    private String toJsonArray(List<String> values) {
        return "[" + values.stream()
                .map(value -> "\"" + value + "\"")
                .reduce((left, right) -> left + "," + right)
                .orElse("") + "]";
    }
}
