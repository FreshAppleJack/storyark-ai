package io.github.freshapplejack.storyark.controller;

import io.github.freshapplejack.storyark.entity.User;
import io.github.freshapplejack.storyark.mapper.UserMapper;
import io.github.freshapplejack.storyark.util.PasswordHasher;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@CrossOrigin(origins = "http://localhost:3000", allowCredentials = "true") // allow cross-origin requests from
// http://localhost:3000
public class AuthController {

    private static final int MAX_NICKNAME_LENGTH = 64;

    @Autowired
    private UserMapper userMapper;

    // login endpoint
    @PostMapping("/login")
    public Object login(@RequestBody Map<String, String> loginRequest, HttpSession session) {
        String username = loginRequest.get("username");
        String password = loginRequest.get("password");

        User user = userMapper.findByUsername(username);

        if (user == null) {
            throw new RuntimeException("Invalid credentials");
        }

        String storedPassword = user.getPassword();
        boolean passwordMatches = PasswordHasher.matches(password, storedPassword);
        boolean isLegacyPlaintextPassword = storedPassword != null && storedPassword.equals(password);

        if (!passwordMatches && !isLegacyPlaintextPassword) {
            throw new RuntimeException("Invalid credentials");
        }

        if (isLegacyPlaintextPassword && !PasswordHasher.isSha256Hash(storedPassword)) {
            userMapper.updatePassword(user.getId(), PasswordHasher.hash(password));
        }

        user.setPassword(null);
        session.setAttribute("loginUser", user);
        return user;
    }

    @PostMapping("/register")
    public String register(@RequestBody Map<String, String> registerRequest) {
        String username = registerRequest.get("username");
        String password = registerRequest.get("password");
        String nickname = registerRequest.get("nickname");

        // 1. check required fields
        if (username == null || password == null) {
            throw new RuntimeException("Username and password are required");
        }

        // 2. check if username already exists
        User existingUser = userMapper.findByUsername(username);
        if (existingUser != null) {
            throw new RuntimeException("Username already exists");
        }

        // 3. create new user
        User newUser = new User();
        newUser.setUsername(username);
        newUser.setPassword(PasswordHasher.hash(password));
        newUser.setNickname(nickname);

        // 4. insert into database
        userMapper.insert(newUser);

        return "Registration successful";
    }

    @PutMapping("/me/nickname")
    public User updateNickname(@RequestBody Map<String, String> payload, HttpSession session) {
        User loginUser = (User) session.getAttribute("loginUser");
        if (loginUser == null) {
            throw new RuntimeException("Please log in first!");
        }

        String nickname = normalizeNickname(payload.get("nickname"));
        userMapper.updateNickname(loginUser.getId(), nickname);
        loginUser.setNickname(nickname);
        loginUser.setPassword(null);
        session.setAttribute("loginUser", loginUser);
        return loginUser;
    }

    private String normalizeNickname(String nickname) {
        if (nickname == null || nickname.trim().isEmpty()) {
            throw new RuntimeException("Nickname is required");
        }
        String normalized = nickname.trim();
        if (normalized.length() > MAX_NICKNAME_LENGTH) {
            throw new RuntimeException("Nickname must be 64 characters or fewer");
        }
        return normalized;
    }
}
