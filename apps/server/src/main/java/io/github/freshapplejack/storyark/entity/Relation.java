package io.github.freshapplejack.storyark.entity;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class Relation {
    private Long id;
    private Long bookId;

    // 不再使用 Long sourceCharId，改为 String nodeKey
    // 这样可以区分同一个角色的不同节点实例

    private String sourceNodeKey;
    private String targetNodeKey;

    // 保存连接的具体句柄 (Handle) ID，用于支持多条连线
    private String sourceHandle;
    private String targetHandle;

    private String label;
    private LocalDateTime createdAt;
}
