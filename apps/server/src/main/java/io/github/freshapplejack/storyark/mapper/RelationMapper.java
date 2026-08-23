package io.github.freshapplejack.storyark.mapper;

import io.github.freshapplejack.storyark.entity.Relation;
import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface RelationMapper {

    @Select("SELECT * FROM sys_relation WHERE book_id = #{bookId}")
    List<Relation> findByBookId(Long bookId);

    // 关键修复：
    // 1. 数据库列名改为 source_node_key, target_node_key
    // 2. Java 属性名改为 #{sourceNodeKey}, #{targetNodeKey}
    @Insert("INSERT INTO sys_relation(book_id, source_node_key, target_node_key, label, source_handle, target_handle) " +
            "VALUES(#{bookId}, #{sourceNodeKey}, #{targetNodeKey}, #{label}, #{sourceHandle}, #{targetHandle})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(Relation relation);

    @Delete("DELETE FROM sys_relation WHERE book_id = #{bookId}")
    int deleteByBookId(Long bookId);
}
