package io.github.freshapplejack.storyark.mapper;

import io.github.freshapplejack.storyark.entity.Chapter;
import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface ChapterMapper {

    // 按照 order_index 排序，确保显示顺序正确
    @Select("SELECT * FROM sys_chapter WHERE volume_id = #{volumeId} ORDER BY order_index ASC, id ASC")
    List<Chapter> findByVolumeId(Long volumeId);

    // 插入时显式带上 order_index 和 is_editable
    @Insert("INSERT INTO sys_chapter(volume_id, title, content, word_count, status, order_index, is_editable, foreshadowings) " +
            "VALUES(#{volumeId}, #{title}, #{content}, #{wordCount}, #{status}, #{orderIndex}, #{isEditable}, #{foreshadowings})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(Chapter chapter);

    // 更新逻辑增加了 is_editable = #{isEditable}
    // 这样当在前端切换锁定状态并保存，或者保存内容时，状态都会被同步
    @Update("UPDATE sys_chapter SET title=#{title}, content=#{content}, word_count=#{wordCount}, " +
            "is_editable=#{isEditable}, foreshadowings=#{foreshadowings}, updated_at=NOW() WHERE id=#{id}")
    int update(Chapter chapter);

    // 专门用于更新排序
    @Update("UPDATE sys_chapter SET order_index=#{orderIndex} WHERE id=#{id}")
    int updateOrder(Chapter chapter);

    @Select("SELECT * FROM sys_chapter WHERE id = #{id}")
    Chapter findById(Long id);

    @Delete("DELETE FROM sys_chapter WHERE id = #{id}")
    int deleteById(Long id);

    @Delete("DELETE FROM sys_chapter WHERE volume_id = #{volumeId}")
    int deleteByVolumeId(Long volumeId);

    @Delete("DELETE FROM sys_chapter WHERE volume_id IN (SELECT id FROM sys_volume WHERE book_id = #{bookId})")
    int deleteByBookId(Long bookId);
}
