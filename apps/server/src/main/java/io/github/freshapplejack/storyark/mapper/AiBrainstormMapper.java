package io.github.freshapplejack.storyark.mapper;

import io.github.freshapplejack.storyark.entity.AiBrainstorm;
import org.apache.ibatis.annotations.*;

@Mapper
public interface AiBrainstormMapper {

    @Select("SELECT * FROM sys_ai_brainstorm WHERE book_id = #{bookId}")
    AiBrainstorm findByBookId(Long bookId);

    @Insert("""
            INSERT INTO sys_ai_brainstorm(
                book_id,
                selected_chapter_ids,
                context_snapshot,
                generated_options,
                selected_option_id,
                final_content
            )
            VALUES(
                #{bookId},
                #{selectedChapterIds},
                #{contextSnapshot},
                #{generatedOptions},
                #{selectedOptionId},
                #{finalContent}
            )
            ON DUPLICATE KEY UPDATE
                selected_chapter_ids = #{selectedChapterIds},
                context_snapshot = #{contextSnapshot},
                generated_options = #{generatedOptions},
                selected_option_id = #{selectedOptionId},
                final_content = #{finalContent},
                updated_at = NOW()
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int upsert(AiBrainstorm brainstorm);

    @Delete("DELETE FROM sys_ai_brainstorm WHERE book_id = #{bookId}")
    int deleteByBookId(Long bookId);
}
