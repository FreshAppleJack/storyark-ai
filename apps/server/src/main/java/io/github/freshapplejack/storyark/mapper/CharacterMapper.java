package io.github.freshapplejack.storyark.mapper;

import io.github.freshapplejack.storyark.entity.Character;
import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface CharacterMapper {

    // 按照 order_index 升序排序，如果 order_index 相同则按 id 排序
    @Select("SELECT * FROM sys_character WHERE book_id = #{bookId} ORDER BY order_index ASC, id ASC")
    List<Character> findByBookId(Long bookId);

    @Select("SELECT * FROM sys_character WHERE id = #{id}")
    Character findById(Long id);

    // 插入时加入 position 字段
    @Insert("INSERT INTO sys_character(book_id, name, role, description, avatar, color, tags, aliases, handle_config, position_x, position_y, order_index) " +
            "VALUES(#{bookId}, #{name}, #{role}, #{description}, #{avatar}, #{color}, #{tags}, #{aliases}, #{handleConfig}, #{positionX}, #{positionY}, #{orderIndex})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(Character character);

    // 动态更新，加入 positionX 和 positionY 的更新逻辑
    @Update("<script>" +
            "UPDATE sys_character " +
            "<set>" +
            "<if test='name != null'>name=#{name},</if>" +
            "<if test='role != null'>role=#{role},</if>" +
            "<if test='description != null'>description=#{description},</if>" +
            "<if test='avatar != null'>avatar=#{avatar},</if>" +
            "<if test='color != null'>color=#{color},</if>" +
            "<if test='tags != null'>tags=#{tags},</if>" +
            "<if test='aliases != null'>aliases=#{aliases},</if>" +
            "<if test='handleConfig != null'>handle_config=#{handleConfig},</if>" +
            "<if test='positionX != null'>position_x=#{positionX},</if>" +
            "<if test='positionY != null'>position_y=#{positionY},</if>" +
            "<if test='orderIndex != null'>order_index=#{orderIndex},</if>" +
            "</set>" +
            "WHERE id=#{id}" +
            "</script>")
    int update(Character character);

    @Update("UPDATE sys_character SET order_index = #{orderIndex} WHERE id = #{id}")
    int updateOrder(Character character);

    @Delete("DELETE FROM sys_character WHERE id = #{id}")
    int deleteById(Long id);

    @Delete("DELETE FROM sys_character WHERE book_id = #{bookId}")
    int deleteByBookId(Long bookId);
}
