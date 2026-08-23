package io.github.freshapplejack.storyark.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class Chapter {
    private Long id;
    private Long volumeId;
    private String title;
    private String content; // 存储正文
    private Integer wordCount;
    private String status;
    private int orderIndex;
    private String foreshadowings;

    // 控制是否可编辑
    // 使用 Boolean 对象类型，默认由 Controller 或 数据库处理
    private Boolean isEditable;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
