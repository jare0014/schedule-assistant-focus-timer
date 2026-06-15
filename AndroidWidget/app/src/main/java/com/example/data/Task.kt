package com.example.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "tasks")
data class Task(
    @PrimaryKey val id: String,
    val text: String,
    val isCompleted: Boolean,
    val notePath: String = "",
    val lineNumber: Int = 0,
    val rawMarkdownLine: String = "",
    val timeRange: String? = null,
    val displayTitle: String = text,
    val category: String = "UNTIMED",
    val subCategory: String? = null,
    val project: String? = null
)
