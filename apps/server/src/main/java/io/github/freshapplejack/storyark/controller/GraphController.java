package io.github.freshapplejack.storyark.controller;

import cdut.s5g2.storyark_sprint5_backend.entity.GraphNode;
import cdut.s5g2.storyark_sprint5_backend.entity.Relation;
import cdut.s5g2.storyark_sprint5_backend.mapper.GraphNodeMapper;
import cdut.s5g2.storyark_sprint5_backend.mapper.RelationMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/books/{bookId}/graph")
@CrossOrigin(origins = "http://localhost:3000", allowCredentials = "true")
public class GraphController {

    @Autowired
    private GraphNodeMapper graphNodeMapper;

    @Autowired
    private RelationMapper relationMapper;

    // 引入 Jackson ObjectMapper 用于 JSON 转换
    private final ObjectMapper objectMapper = new ObjectMapper();

    // 1. 获取整个图谱数据 (Nodes + Edges)
    @GetMapping
    public Map<String, Object> getGraphData(@PathVariable Long bookId) {
        Map<String, Object> result = new HashMap<>();

        // 获取所有节点实例 (包含位置和对应的角色信息)
        List<GraphNode> nodes = graphNodeMapper.findByBookId(bookId);

        // 获取所有连线 (基于 NodeKey 连接)
        List<Relation> edges = relationMapper.findByBookId(bookId);

        result.put("nodes", nodes);
        result.put("edges", edges);
        return result;
    }

    // 2. 保存整个图谱 (全量覆盖)
    @PostMapping
    @Transactional
    public String saveGraphData(@PathVariable Long bookId, @RequestBody Map<String, Object> payload) {
        // 1. 解析数据
        List<Map<String, Object>> nodesData = (List<Map<String, Object>>) payload.get("nodes");
        List<Map<String, Object>> edgesData = (List<Map<String, Object>>) payload.get("edges");

        // 2. 清除旧数据 (先删线，再删点)
        relationMapper.deleteByBookId(bookId);
        graphNodeMapper.deleteByBookId(bookId);

        // 3. 插入新节点
        if (nodesData != null) {
            for (Map<String, Object> nodeMap : nodesData) {
                GraphNode node = new GraphNode();
                node.setBookId(bookId);
                node.setNodeKey((String) nodeMap.get("id"));
                node.setCharacterId(((Number) nodeMap.get("characterId")).longValue());

                node.setPositionX(((Number) nodeMap.get("x")).doubleValue());
                node.setPositionY(((Number) nodeMap.get("y")).doubleValue());

                // --- 关键修复：正确序列化 handleConfig ---
                Object configObj = nodeMap.get("handleConfig");
                if (configObj != null) {
                    try {
                        // 如果前端传来的已经是字符串，直接使用
                        if (configObj instanceof String) {
                            node.setHandleConfig((String) configObj);
                        } else {
                            // 否则将 Map 对象转换为合法的 JSON 字符串
                            String jsonString = objectMapper.writeValueAsString(configObj);
                            node.setHandleConfig(jsonString);
                        }
                    } catch (JsonProcessingException e) {
                        e.printStackTrace();
                        node.setHandleConfig("{}"); // 序列化失败时存入空 JSON
                    }
                } else {
                    node.setHandleConfig("{}");
                }
                // ---------------------------------------

                graphNodeMapper.insert(node);
            }
        }

        // 4. 插入新连线
        if (edgesData != null) {
            for (Map<String, Object> edgeMap : edgesData) {
                Relation relation = new Relation();
                relation.setBookId(bookId);
                relation.setSourceNodeKey((String) edgeMap.get("source"));
                relation.setTargetNodeKey((String) edgeMap.get("target"));
                relation.setLabel((String) edgeMap.get("label"));

                relation.setSourceHandle((String) edgeMap.get("sourceHandle"));
                relation.setTargetHandle((String) edgeMap.get("targetHandle"));
                relationMapper.insert(relation);
            }
        }

        return "Graph saved successfully";
    }
}
