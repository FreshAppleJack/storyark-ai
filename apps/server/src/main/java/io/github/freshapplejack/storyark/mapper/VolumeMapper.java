package io.github.freshapplejack.storyark.mapper;

import io.github.freshapplejack.storyark.entity.Volume;
import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface VolumeMapper {

    // 修改：按照 order_index 排序，如果 order_index 相同则按 id 排序
    @Select("SELECT * FROM sys_volume WHERE book_id = #{bookId} ORDER BY order_index ASC, id ASC")
    @Results({
            @Result(property = "id", column = "id"),
            @Result(property = "orderIndex", column = "order_index"),
            @Result(property = "chapters", column = "id",
                    many = @Many(select = "io.github.freshapplejack.storyark.mapper.ChapterMapper.findByVolumeId"))
    })
    List<Volume> findByBookId(Long bookId);

    @Update("UPDATE sys_volume SET title=#{title}, order_index=#{orderIndex} WHERE id=#{id}")
    int update(Volume Volume);

    // 专门用于更新顺序的方法
    @Update("UPDATE sys_volume SET order_index=#{orderIndex} WHERE id=#{id}")
    int updateOrder(Volume volume);

    // 插入时默认 order_index 为 0
    @Insert("INSERT INTO sys_volume(book_id, title, order_index) VALUES(#{bookId}, #{title}, 0)")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(Volume volume);

    @Delete("DELETE FROM sys_volume WHERE id = #{id}")
    int deleteById(Long id);

    @Delete("DELETE FROM sys_volume WHERE book_id = #{bookId}")
    int deleteByBookId(Long bookId);
}
