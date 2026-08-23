package io.github.freshapplejack.storyark.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class Character {
    private Long id;
    private Long bookId;
    private String name;

    // 对应前端 role: 'protagonist' | 'antagonist' | 'supporting' | 'mob'
    private String role;

    private String description;
    private String avatar;
    private String color;

    // 数据库中存储为 JSON 字符串
    private String tags;

    // 角色别名，仅用于编辑器自动高亮，数据库中存储为 JSON 字符串
    private String aliases;

    // 连线点配置，数据库中存储为 JSON 字符串
    // 前端格式: { "top": "source", "right": "target", ... }
    private String handleConfig;
    private Double positionX;
    private Double positionY;

    private Integer orderIndex;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
