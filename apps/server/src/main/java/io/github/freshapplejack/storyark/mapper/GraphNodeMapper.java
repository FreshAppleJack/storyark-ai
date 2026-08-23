package io.github.freshapplejack.storyark.mapper;

import cdut.s5g2.storyark_sprint5_backend.entity.GraphNode;
import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface GraphNodeMapper {

    // 联合查询：获取节点的同时，获取角色的基本信息（名字、颜色等）
    @Select("SELECT n.*, c.name, c.role, c.avatar, c.color " +
            "FROM sys_graph_node n " +
            "LEFT JOIN sys_character c ON n.character_id = c.id " +
            "WHERE n.book_id = #{bookId}")
    List<GraphNode> findByBookId(Long bookId);

    @Insert("INSERT INTO sys_graph_node(book_id, character_id, node_key, position_x, position_y, handle_config) " +
            "VALUES(#{bookId}, #{characterId}, #{nodeKey}, #{positionX}, #{positionY}, #{handleConfig})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(GraphNode node);

    @Delete("DELETE FROM sys_graph_node WHERE book_id = #{bookId}")
    int deleteByBookId(Long bookId);
}
