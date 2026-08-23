package io.github.freshapplejack.storyark.entity;

import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
public class UserSettings {
    private Long id;
    private Long userId;
    private Boolean darkMode;
    private Integer editorMarginPx;
    private BigDecimal editorLineHeight;
    private Integer editorFontSizePx;
    private String editorFontFamily;
    private Integer aiContinueContextChars;
    private Integer aiContinueOutputChars;
    private Boolean autoHighlightEnabled;
    private String autoHighlightTags;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
