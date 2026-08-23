package io.github.freshapplejack.storyark.controller;

import cdut.s5g2.storyark_sprint5_backend.entity.Relation;
import cdut.s5g2.storyark_sprint5_backend.mapper.RelationMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/books/{bookId}/relations")
@CrossOrigin(origins = "http://localhost:3000", allowCredentials = "true")
public class RelationController {

    @Autowired
    private RelationMapper relationMapper;

    // 1. 获取某本书的所有关系
    @GetMapping
    public List<Relation> getRelations(@PathVariable Long bookId) {
        return relationMapper.findByBookId(bookId);
    }

    // 2. 批量保存关系 (全量覆盖模式)
    // 前端点击"保存"时，将当前所有连线数据发送过来
    @PostMapping("/batch")
    @Transactional
    public String saveRelations(@PathVariable Long bookId, @RequestBody List<Relation> relations) {
        // 1. 清除旧关系
        relationMapper.deleteByBookId(bookId);

        // 2. 插入新关系
        for (Relation r : relations) {
            r.setBookId(bookId); // 确保 ID 一致
            relationMapper.insert(r);
        }
        return "Relations saved successfully";
    }
}
