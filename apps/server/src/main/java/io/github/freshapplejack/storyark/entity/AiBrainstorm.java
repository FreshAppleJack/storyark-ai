package io.github.freshapplejack.storyark.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class AiBrainstorm {
    private Long id;
    private Long bookId;
    private String selectedChapterIds;
    private String contextSnapshot;
    private String generatedOptions;
    private String selectedOptionId;
    private String finalContent;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
