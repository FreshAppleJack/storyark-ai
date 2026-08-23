package io.github.freshapplejack.storyark.controller;

import io.github.freshapplejack.storyark.entity.Chapter;
import io.github.freshapplejack.storyark.entity.Volume;
import io.github.freshapplejack.storyark.mapper.BookMapper;
import io.github.freshapplejack.storyark.mapper.ChapterMapper;
import io.github.freshapplejack.storyark.mapper.VolumeMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/story")
@CrossOrigin(origins = "http://localhost:3000", allowCredentials = "true")
public class StoryController {

    @Autowired
    private VolumeMapper volumeMapper;

    @Autowired
    private ChapterMapper chapterMapper;

    @Autowired
    private BookMapper bookMapper;

    // 1. 新建卷
    @PostMapping("/volumes")
    public Volume createVolume(@RequestBody Volume volume) {
        volumeMapper.insert(volume);
        if (volume.getBookId() != null) {
            bookMapper.updateTime(volume.getBookId());
        }
        return volume;
    }

    // 2. 新建章节
    @PostMapping("/chapters")
    public Chapter createChapter(@RequestBody Chapter chapter, @RequestParam(required = false) Long bookId) {
        if (chapter.getStatus() == null) {
            chapter.setStatus("draft");
        }
        if (chapter.getWordCount() == null) {
            chapter.setWordCount(0);
        }
        // 设置默认可编辑状态为 true
        if (chapter.getIsEditable() == null) {
            chapter.setIsEditable(true);
        }
        if (chapter.getForeshadowings() == null) {
            chapter.setForeshadowings("[]");
        }

        chapterMapper.insert(chapter);

        if (bookId != null) {
            bookMapper.updateTime(bookId);
        }
        return chapter;
    }

    // 3. 更新卷 (重命名)
    @PutMapping("/volumes/{id}")
    public String updateVolume(@PathVariable Long id, @RequestBody Volume volume) {
        volume.setId(id);
        volumeMapper.update(volume);

        if (volume.getBookId() != null) {
            bookMapper.updateTime(volume.getBookId());
        }
        return "Volume updated";
    }

    // 4. 删除卷
    @DeleteMapping("/volumes/{id}")
    @Transactional
    public String deleteVolume(@PathVariable Long id, @RequestParam(required = false) Long bookId) {
        chapterMapper.deleteByVolumeId(id);
        volumeMapper.deleteById(id);

        if (bookId != null) {
            bookMapper.updateTime(bookId);
        }
        return "Volume and its chapters deleted";
    }

    // 5. 删除章节
    @DeleteMapping("/chapters/{id}")
    public String deleteChapter(@PathVariable Long id, @RequestParam(required = false) Long bookId) {
        chapterMapper.deleteById(id);

        if (bookId != null) {
            bookMapper.updateTime(bookId);
        }
        return "Chapter deleted";
    }

    // 6. 保存/更新章节内容 (包含 isEditable 状态更新)
    @PutMapping("/chapters/{id}")
    public String updateChapter(@PathVariable Long id, @RequestBody Chapter chapter, @RequestParam(required = false) Long bookId) {
        chapter.setId(id);
        if (chapter.getForeshadowings() == null) {
            chapter.setForeshadowings("[]");
        }

        // 如果前端没有传 isEditable，这里可能会是 null。
        // 但通常 Mybatis 的 Update 会更新所有字段。
        // 为了安全起见，如果前端是只更新内容，确保前端传回了当前的 isEditable 状态，或者在这里先查后改（较慢）。
        // 假设前端在保存时会提交完整的 Chapter 对象（包括 isEditable）。

        chapterMapper.update(chapter);

        if (bookId != null) {
            bookMapper.updateTime(bookId);
        }
        return "Chapter saved";
    }

    // 7. 卷排序
    @PostMapping("/volumes/reorder")
    @Transactional
    public String reorderVolumes(@RequestBody List<Long> volumeIds, @RequestParam Long bookId) {
        for (int i = 0; i < volumeIds.size(); i++) {
            Volume v = new Volume();
            v.setId(volumeIds.get(i));
            v.setOrderIndex(i);
            volumeMapper.updateOrder(v);
        }
        bookMapper.updateTime(bookId);
        return "Volumes reordered";
    }

    // 8. 章节排序
    @PostMapping("/chapters/reorder")
    @Transactional
    public String reorderChapters(@RequestBody List<Long> chapterIds, @RequestParam Long bookId) {
        for (int i = 0; i < chapterIds.size(); i++) {
            Chapter c = new Chapter();
            c.setId(chapterIds.get(i));
            c.setOrderIndex(i);
            chapterMapper.updateOrder(c);
        }
        bookMapper.updateTime(bookId);
        return "Chapters reordered";
    }
}
