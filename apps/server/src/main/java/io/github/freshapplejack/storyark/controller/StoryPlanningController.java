package io.github.freshapplejack.storyark.controller;

import io.github.freshapplejack.storyark.entity.StoryPlanning;
import io.github.freshapplejack.storyark.mapper.BookMapper;
import io.github.freshapplejack.storyark.mapper.StoryPlanningMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/books/{bookId}/planning")
@CrossOrigin(origins = "http://localhost:3000", allowCredentials = "true")
public class StoryPlanningController {

    @Autowired
    private StoryPlanningMapper storyPlanningMapper;

    @Autowired
    private BookMapper bookMapper;

    @GetMapping
    public StoryPlanning getPlanning(@PathVariable Long bookId) {
        StoryPlanning planning = storyPlanningMapper.findByBookId(bookId);
        if (planning != null) {
            return planning;
        }

        StoryPlanning emptyPlanning = new StoryPlanning();
        emptyPlanning.setBookId(bookId);
        emptyPlanning.setStorySummary("");
        emptyPlanning.setStoryBackground("");
        emptyPlanning.setChapterSummaries("[]");
        emptyPlanning.setPlotSettings("[]");
        return emptyPlanning;
    }

    @PutMapping
    public StoryPlanning savePlanning(@PathVariable Long bookId, @RequestBody StoryPlanning planning) {
        planning.setBookId(bookId);
        if (planning.getStorySummary() == null) {
            planning.setStorySummary("");
        }
        if (planning.getStoryBackground() == null) {
            planning.setStoryBackground("");
        }
        if (planning.getChapterSummaries() == null) {
            planning.setChapterSummaries("[]");
        }
        if (planning.getPlotSettings() == null) {
            planning.setPlotSettings("[]");
        }

        storyPlanningMapper.upsert(planning);
        bookMapper.updateTime(bookId);
        return storyPlanningMapper.findByBookId(bookId);
    }
}
