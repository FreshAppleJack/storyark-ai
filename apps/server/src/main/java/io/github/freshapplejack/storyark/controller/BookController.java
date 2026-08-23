package io.github.freshapplejack.storyark.controller;

import cdut.s5g2.storyark_sprint5_backend.entity.Book;
import cdut.s5g2.storyark_sprint5_backend.entity.User;
import cdut.s5g2.storyark_sprint5_backend.mapper.*;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/books")
@CrossOrigin(origins = "http://localhost:3000", allowCredentials = "true") // allow cross-origin requests from http://localhost:3000
public class BookController {

    @Autowired
    private BookMapper bookMapper;
    @Autowired
    private VolumeMapper volumeMapper;
    @Autowired
    private ChapterMapper chapterMapper;
    @Autowired
    private StoryPlanningMapper storyPlanningMapper;
    @Autowired
    private AiBrainstormMapper aiBrainstormMapper;

    // get all books in the user's shelf (GET /api/books?userId=1)
    @GetMapping
    public List<Book> getMyBooks(HttpSession session) {

        User loginUser = (User) session.getAttribute("loginUser");

        if (loginUser == null) {
            throw new RuntimeException("Please log in first!");
        }

        return bookMapper.findByUserId(loginUser.getId());
    }

    // create a new book (POST /api/books)
    @PostMapping
    public String createBook(@RequestBody Book book, HttpSession session) {
        // map the JSON request body to the Book object
        // set default values
        User loginUser = (User) session.getAttribute("loginUser");
        if (loginUser == null) {
            throw new RuntimeException("Please log in first!");
        }

        book.setUserId(loginUser.getId()); //make userId equal to login id

        if (book.getCoverColor() == null) {
            book.setCoverColor("bg-blue-600");
        }
        book.setStatus(1); // default status is 1 (serializing)

        bookMapper.insert(book);
        return "Book created successfully!";
    }

    // 更新书本 (重命名 / 修改状态)
    @PutMapping("/{id}")
    public String updateBook(@PathVariable Long id, @RequestBody Book book) {
        book.setId(id);
        bookMapper.update(book);
        bookMapper.updateTime(id);
        return "Book updated";
    }

    // 删除书本 (级联删除)
    @DeleteMapping("/{id}")
    @Transactional // 事务保证原子性
    public String deleteBook(@PathVariable Long id) {
        // 0. 删除该书的故事规划数据
        storyPlanningMapper.deleteByBookId(id);
        aiBrainstormMapper.deleteByBookId(id);

        // 1. 删除该书下所有卷的所有章节
        chapterMapper.deleteByBookId(id);

        // 2. 删除该书下的所有卷
        volumeMapper.deleteByBookId(id);

        // 3. 删除书本本身
        bookMapper.deleteById(id);

        return "Book and all its contents deleted";
    }
}
