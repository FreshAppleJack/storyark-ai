package io.github.freshapplejack.storyark.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class StoryPlanning {
    private Long id;
    private Long bookId;
    private String storySummary;
    private String storyBackground;
    private String chapterSummaries;
    private String plotSettings;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
