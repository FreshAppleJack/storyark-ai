package io.github.freshapplejack.storyark.mapper;

import cdut.s5g2.storyark_sprint5_backend.entity.Book;
import org.apache.ibatis.annotations.*;
import java.util.List;

@Mapper
public interface BookMapper {
    @Insert("INSERT INTO sys_book(user_id, title, cover_color, status, created_at, updated_at) VALUES(#{userId}, #{title}, #{coverColor}, #{status}, NOW(), NOW())")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(Book book);

    //级联查询，将书本的Volume也查询出来
    @Select("SELECT * FROM sys_book WHERE user_id = #{userId} ORDER BY updated_at DESC")
    @Results({
            @Result(property = "id", column = "id"),
            @Result(property = "userId", column = "user_id"),
            @Result(property = "title", column = "title"),
            @Result(property = "coverColor", column = "cover_color"),
            @Result(property = "status", column = "status"),
            @Result(property = "createdAt", column = "created_at"),
            @Result(property = "updatedAt", column = "updated_at"),
            // 关键点：自动调用 CharacterMapper.findByBookId 填充 characters 列表
            @Result(property = "characters", column = "id",
                    many = @Many(select = "cdut.s5g2.storyark_sprint5_backend.mapper.CharacterMapper.findByBookId")),
            // 之前的 volumes 映射保持不变...
            @Result(property = "volumes", column = "id",
                    many = @Many(select = "cdut.s5g2.storyark_sprint5_backend.mapper.VolumeMapper.findByBookId"))
    })
    List<Book> findByUserId(Long userId);

    // 更新书本基本信息时，显式将 updated_at 更新为 NOW()
    @Update("UPDATE sys_book SET title=#{title}, status=#{status}, updated_at=NOW() WHERE id=#{id}")
    int update(Book book);

    // 刷新书本的“最后修改时间”
    @Update("UPDATE sys_book SET updated_at = NOW() WHERE id = #{id}")
    void updateTime(Long id);

    // 删除书本
    @Delete("DELETE FROM sys_book WHERE id = #{id}")
    int deleteById(Long id);
}
