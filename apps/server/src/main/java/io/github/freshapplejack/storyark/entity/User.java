package io.github.freshapplejack.storyark.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("sys_user")
public class User {
    private Long id;
    private String username;
    private String password;
    private String nickname;

    @TableField("create_at")
    private LocalDateTime createdAt;

}
