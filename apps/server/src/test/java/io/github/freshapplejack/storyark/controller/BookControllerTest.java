package io.github.freshapplejack.storyark.controller;

import io.github.freshapplejack.storyark.entity.Book;
import io.github.freshapplejack.storyark.entity.User;
import io.github.freshapplejack.storyark.mapper.BookMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class BookControllerTest {
    @Test
    void creationReturnsGeneratedIdAndAuthenticatedOwner() throws Exception {
        BookMapper mapper = mock(BookMapper.class);
        doAnswer(invocation -> {
            Book book = invocation.getArgument(0);
            book.setId(42L);
            return null;
        }).when(mapper).insert(any(Book.class));
        BookController controller = new BookController();
        ReflectionTestUtils.setField(controller, "bookMapper", mapper);
        User user = new User();
        user.setId(7L);
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("loginUser", user);

        MockMvcBuilders.standaloneSetup(controller).build()
            .perform(post("/api/books").session(session).contentType("application/json")
                .content("{\"title\":\"New book\",\"userId\":99}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(42))
            .andExpect(jsonPath("$.userId").value(7));
    }
}
