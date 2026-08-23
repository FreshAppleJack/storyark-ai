package io.github.freshapplejack.storyark.entity;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

@Data
public class Volume {
    private Long id;
    private Long bookId;
    private String title;
    private Integer orderIndex;
    private LocalDateTime createdAt;
    private List<Chapter> chapters;
}
