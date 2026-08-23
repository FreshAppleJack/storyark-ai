package io.github.freshapplejack.storyark.entity;

import lombok.Data;

@Data
public class GraphNode {
    private Long id;            // 数据库主键
    private Long bookId;
    private Long characterId;   // 关联的角色ID

    // 关键字段：对应前端 React Flow 的 Node ID (String 类型)
    // 因为前端拖拽生成的新节点 ID 可能是 "5_171567890" 这种格式
    private String nodeKey;

    private Double positionX;
    private Double positionY;
    private String handleConfig; // JSON

    // --- DTO Fields (用于前端显示，不存储在 graph_node 表中，通过 Join 查询获取) ---
    private String name;
    private String role;
    private String avatar;
    private String color;
}
