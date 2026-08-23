package io.github.freshapplejack.storyark.entity;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class Book {
    private Long id;
    private Long userId;
    private String title;
    private String coverColor;
    private Integer status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private List<Volume> volumes;
    // 对应 BookMapper 中的 property = "characters"
    private List<Character> characters;
}
