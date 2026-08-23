package io.github.freshapplejack.storyark.mapper;

import io.github.freshapplejack.storyark.entity.UserSettings;
import org.apache.ibatis.annotations.*;

import java.math.BigDecimal;

@Mapper
public interface UserSettingsMapper {
    @Select("SELECT * FROM sys_user_settings WHERE user_id = #{userId}")
    UserSettings findByUserId(Long userId);

    @Insert("""
            INSERT INTO sys_user_settings(
                user_id,
                dark_mode,
                editor_margin_px,
                editor_line_height,
                editor_font_size_px,
                editor_font_family,
                ai_continue_context_chars,
                ai_continue_output_chars,
                auto_highlight_enabled,
                auto_highlight_tags
            )
            VALUES(
                #{userId},
                #{darkMode},
                #{editorMarginPx},
                #{editorLineHeight},
                #{editorFontSizePx},
                #{editorFontFamily},
                #{aiContinueContextChars},
                #{aiContinueOutputChars},
                #{autoHighlightEnabled},
                #{autoHighlightTags}
            )
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(UserSettings settings);

    @Update("UPDATE sys_user_settings SET dark_mode = #{darkMode}, updated_at = NOW() WHERE user_id = #{userId}")
    int updateDarkMode(@Param("userId") Long userId, @Param("darkMode") Boolean darkMode);

    @Update("""
            UPDATE sys_user_settings
            SET editor_margin_px = #{editorMarginPx},
                editor_line_height = #{editorLineHeight},
                updated_at = NOW()
            WHERE user_id = #{userId}
            """)
    int updateEditorSpacing(
            @Param("userId") Long userId,
            @Param("editorMarginPx") Integer editorMarginPx,
            @Param("editorLineHeight") BigDecimal editorLineHeight
    );

    @Update("""
            UPDATE sys_user_settings
            SET ai_continue_context_chars = #{aiContinueContextChars},
                ai_continue_output_chars = #{aiContinueOutputChars},
                updated_at = NOW()
            WHERE user_id = #{userId}
            """)
    int updateAiContinue(
            @Param("userId") Long userId,
            @Param("aiContinueContextChars") Integer aiContinueContextChars,
            @Param("aiContinueOutputChars") Integer aiContinueOutputChars
    );

    @Update("""
            UPDATE sys_user_settings
            SET auto_highlight_tags = #{autoHighlightTags},
                updated_at = NOW()
            WHERE user_id = #{userId}
            """)
    int updateAutoHighlightTags(
            @Param("userId") Long userId,
            @Param("autoHighlightTags") String autoHighlightTags
    );
}
