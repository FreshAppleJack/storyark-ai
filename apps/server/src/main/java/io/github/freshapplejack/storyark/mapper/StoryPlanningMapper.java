package io.github.freshapplejack.storyark.mapper;

import cdut.s5g2.storyark_sprint5_backend.entity.StoryPlanning;
import org.apache.ibatis.annotations.*;

@Mapper
public interface StoryPlanningMapper {

    @Select("SELECT * FROM sys_story_planning WHERE book_id = #{bookId}")
    StoryPlanning findByBookId(Long bookId);

    @Insert("INSERT INTO sys_story_planning(book_id, story_summary, story_background, chapter_summaries, plot_settings) " +
            "VALUES(#{bookId}, #{storySummary}, #{storyBackground}, #{chapterSummaries}, #{plotSettings}) " +
            "ON DUPLICATE KEY UPDATE story_summary=#{storySummary}, story_background=#{storyBackground}, " +
            "chapter_summaries=#{chapterSummaries}, plot_settings=#{plotSettings}, updated_at=NOW()")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int upsert(StoryPlanning planning);

    @Delete("DELETE FROM sys_story_planning WHERE book_id = #{bookId}")
    int deleteByBookId(Long bookId);
}
