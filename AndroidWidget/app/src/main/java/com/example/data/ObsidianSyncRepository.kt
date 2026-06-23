package com.example.data

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class ObsidianSyncRepository(private val context: Context) {
    private val db = AppDatabase.getDatabase(context)
    private val taskDao = db.taskDao()
    private val prefs = SyncPreferences(context)

    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()

    fun getAllTasksFlow() = taskDao.getAllTasks()

    suspend fun getLocalTasks() = taskDao.getAllTasksDirect()

    private fun getBaseUrl(): String {
        var ip = prefs.serverIp.trim()
        val port = prefs.serverPort.trim()
        if (!ip.startsWith("http://") && !ip.startsWith("https://")) {
            ip = "http://$ip"
        }
        return if (port.isNotEmpty()) {
            "$ip:$port"
        } else {
            ip
        }
    }

    fun getResolvedPathOrEndpoint(): String {
        val raw = prefs.pathOrEndpoint.trim()
        val calendar = java.util.Calendar.getInstance()
        val year = calendar.get(java.util.Calendar.YEAR).toString()
        val month = String.format("%02d", calendar.get(java.util.Calendar.MONTH) + 1)
        val day = String.format("%02d", calendar.get(java.util.Calendar.DAY_OF_MONTH))
        
        val yyyyMMdd = "$year-$month-$day"
        val yyyySlashMMSlashdd = "$year/$month/$day"
        
        return raw
            .replace("{YYYY-MM-DD}", yyyyMMdd)
            .replace("{yyyy-mm-dd}", yyyyMMdd)
            .replace("{YYYY/MM/DD}", yyyySlashMMSlashdd)
            .replace("{yyyy/mm/dd}", yyyySlashMMSlashdd)
            .replace("{date}", yyyyMMdd)
    }

    private fun getFullUrl(): String {
        val base = getBaseUrl()
        val endpoint = getResolvedPathOrEndpoint()
        val formattedEndpoint = if (endpoint.startsWith("/")) endpoint else "/$endpoint"
        return "$base$formattedEndpoint"
    }

    suspend fun syncTasks(): Boolean {
        prefs.addLog("Starting synchronization in ${prefs.syncMode} mode...")
        val url = getFullUrl()
        prefs.addLog("Syncing URL: $url")

        val requestBuilder = Request.Builder()
            .url(url)
            .get()

        if (prefs.apiToken.isNotEmpty()) {
            requestBuilder.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            // Some Obsidian plugins use 'X-API-Key' or 'Authorization'
            requestBuilder.addHeader("X-API-Key", prefs.apiToken)
        }

        try {
            val response = client.newCall(requestBuilder.build()).execute()
            if (!response.isSuccessful) {
                val errMsg = "HTTP Failure: ${response.code} ${response.message}"
                prefs.addLog(errMsg)
                prefs.lastSyncStatus = "Failed: Server returned code ${response.code}"
                return false
            }

            val responseBody = response.body?.string() ?: ""
            if (responseBody.isEmpty()) {
                prefs.addLog("Success, but remote returned empty content.")
                taskDao.clearTasks()
                prefs.lastSyncTime = System.currentTimeMillis()
                prefs.lastSyncStatus = "Success (Empty File)"
                triggerWidgetUpdate()
                return true
            }

            if (prefs.syncMode == "MARKDOWN") {
                parseAndSaveMarkdown(responseBody)
            } else {
                parseAndSaveJson(responseBody)
            }

            // Sync the active timer state as well
            syncActiveTimer()

            prefs.lastSyncTime = System.currentTimeMillis()
            prefs.lastSyncStatus = "Success"
            triggerWidgetUpdate()
            return true
        } catch (e: IOException) {
            val errMsg = "Network request failed: ${e.message}"
            Log.e("SyncRepository", errMsg, e)
            prefs.addLog(errMsg)
            if (e.message?.contains("cleartext") == true) {
                prefs.addLog("TROUBLESHOOTING TIP: Android blocks HTTP traffic by default. Please configure usesCleartextTraffic in Manifest or use HTTPS.")
            } else if (e.message?.contains("timeout") == true || e.message?.contains("Timeout") == true) {
                prefs.addLog("TROUBLESHOOTING TIP: Check if your PC and Android device are connected to the same local Wi-Fi router.")
            } else if (e.message?.contains("refused") == true) {
                prefs.addLog("TROUBLESHOOTING TIP: Connection refused. Verify the server is running on Obsidian port ${prefs.serverPort} on your PC.")
            }
            prefs.lastSyncStatus = "Failed: Connection Error"
            return false
        } catch (e: Exception) {
            val errMsg = "Unexpected sync exception: ${e.message}"
            Log.e("SyncRepository", errMsg, e)
            prefs.addLog(errMsg)
            prefs.lastSyncStatus = "Failed: Error"
            return false
        }
    }

    private suspend fun parseAndSaveMarkdown(content: String) {
        val lines = content.split(Regex("\\r?\\n"))
        val parsedTasks = mutableListOf<Task>()
        
        // Match standard markdown task checklists: e.g. - [ ] Buy milk or - [x] Walk the dog
        val taskRegex = Regex("^([\\s]*)[-*][\\s]+\\[([\\s*xX]?)\\][\\s]+(.*)$")

        var currentCategory = "UNTIMED"
        var currentSubCategory: String? = null
        var currentProject: String? = null
        var mainDateHeaderString: String? = null

        // Regex to match a 12-hour or 24-hour time range (e.g., "18:30 - 19:00" or "6:30 PM - 7:00 PM")
        val timeRangeRegex = Regex("(\\d{1,2}:\\d{2}\\s*(?:[aApP][mM])?\\s*-\\s*\\d{1,2}:\\d{2}\\s*(?:[aApP][mM])?)")

        for ((index, line) in lines.withIndex()) {
            val trimmedLine = line.trim()
            if (trimmedLine.startsWith("#")) {
                val title = trimmedLine.replace(Regex("^#+\\s*"), "").trim()
                if (trimmedLine.startsWith("# ")) {
                    mainDateHeaderString = title
                } else if (trimmedLine.startsWith("## ")) {
                    val upper = title.uppercase()
                    if (upper.contains("FOCUS") || upper.contains("BLOCK")) {
                        currentCategory = "FOCUS BLOCKS"
                        currentSubCategory = null
                        currentProject = null
                    } else if (upper.contains("FLOATING") || upper.contains("MICRO") || upper.contains("UNTIMED")) {
                        currentCategory = "FLOATING MICRO-TASKS"
                        currentSubCategory = null
                        currentProject = null
                    } else {
                        currentCategory = "FLOATING MICRO-TASKS"
                        currentSubCategory = title
                        currentProject = null
                    }
                } else if (trimmedLine.startsWith("### ") || trimmedLine.startsWith("#### ")) {
                    currentSubCategory = title
                    currentProject = null
                } else if (trimmedLine.startsWith("##### ")) {
                    currentProject = title
                }
                continue
            }

            val summaryRegex = Regex("<summary>(?:<b>)?(.*?)(?:</b>)?</summary>", RegexOption.IGNORE_CASE)
            val summaryMatch = summaryRegex.find(trimmedLine)
            if (summaryMatch != null) {
                currentProject = summaryMatch.groupValues[1].trim()
            }
            if (trimmedLine.contains("</details>", ignoreCase = true)) {
                currentProject = null
            }

            val matchResult = taskRegex.matchEntire(line)
            if (matchResult != null) {
                val indent = matchResult.groupValues[1]
                val statusChar = matchResult.groupValues[2]
                val text = matchResult.groupValues[3].trim()
                
                val isCompleted = statusChar.lowercase() == "x"

                // Check for a time range signature (e.g. "18:30 - 19:00")
                val timeRangeMatch = timeRangeRegex.find(text)
                val (timeRange, displayTitle) = if (timeRangeMatch != null) {
                    val tr = timeRangeMatch.groupValues[1]
                    val cleanText = text.replace(tr, "").replace(Regex("^\\s*-\\s*"), "").trim()
                    Pair(tr, cleanText)
                } else {
                    Pair(null, text)
                }

                // Auto-democratize as FOCUS BLOCK if a time range is present
                val resolvedCategory = if (timeRange != null) "FOCUS BLOCKS" else currentCategory

                val stableId = "md_${getResolvedPathOrEndpoint().hashCode()}_${index}_${text.hashCode()}"

                parsedTasks.add(
                    Task(
                        id = stableId,
                        text = text,
                        isCompleted = isCompleted,
                        notePath = getResolvedPathOrEndpoint(),
                        lineNumber = index + 1, // 1-based index
                        rawMarkdownLine = line,
                        timeRange = timeRange,
                        displayTitle = displayTitle,
                        category = resolvedCategory,
                        subCategory = currentSubCategory,
                        project = currentProject
                    )
                )
            }
        }

        if (mainDateHeaderString != null) {
            prefs.lastSyncDateHeader = mainDateHeaderString
        } else {
            val timestamp = java.text.SimpleDateFormat("EEE, MMM d", java.util.Locale.getDefault()).format(java.util.Date())
            prefs.lastSyncDateHeader = timestamp
        }

        taskDao.clearTasks()
        if (parsedTasks.isNotEmpty()) {
            taskDao.insertTasks(parsedTasks)
            prefs.addLog("Parsed ${parsedTasks.size} tasks (smart-grouped by categories & timers).")
        } else {
            prefs.addLog("No checklists parsed. Make sure they use '- [ ] task name' or '* [ ] task name'.")
        }
    }

    private suspend fun parseAndSaveJson(jsonContent: String) {
        val tasks = mutableListOf<Task>()
        try {
            val trimmedJson = jsonContent.trim()
            var foundArray: JSONArray? = null
            var dateHeader: String? = null
            
            if (trimmedJson.startsWith("[")) {
                foundArray = JSONArray(trimmedJson)
            } else if (trimmedJson.startsWith("{")) {
                val obj = JSONObject(trimmedJson)
                dateHeader = obj.optString("dateStr").ifEmpty { null }
                
                // Parse activeTimer directly if present in JSON mode status response
                parseAndSaveActiveTimerObj(obj)
                
                val possibleKeys = listOf("schedule", "tasks", "todos", "items", "data")
                for (key in possibleKeys) {
                    if (obj.has(key)) {
                        foundArray = obj.optJSONArray(key)
                        if (foundArray != null) break
                    }
                }
                
                if (foundArray == null && obj.has("content")) {
                    // This could be Obsidian Local REST API format! It returns {"content": "...raw markdown..."}
                    val markdownText = obj.optString("content", "")
                    parseAndSaveMarkdown(markdownText)
                    return
                }
            }

            if (foundArray != null) {
                for (i in 0 until foundArray.length()) {
                    val taskObj = foundArray.getJSONObject(i)
                    val text = taskObj.optString("description")
                        .ifEmpty { taskObj.optString("text") }
                        .ifEmpty { taskObj.optString("title") }
                        .ifEmpty { taskObj.optString("content") }
                        .ifEmpty { "task_$i" }

                    val isCompleted = taskObj.optString("status").lowercase() == "completed" ||
                            taskObj.optBoolean("completed") ||
                            taskObj.optBoolean("done") ||
                            taskObj.optBoolean("checked")

                    val id = taskObj.optString("id")
                        .ifEmpty { taskObj.optString("key") }
                        .ifEmpty { "json_${text.hashCode()}_$i" }
                        
                    // Parse time range if available
                    var timeRange: String? = null
                    if (taskObj.has("startHour") && !taskObj.isNull("startHour")) {
                        val startHour = taskObj.optInt("startHour")
                        val startMin = taskObj.optInt("startMin")
                        val endHour = taskObj.optInt("endHour")
                        val endMin = taskObj.optInt("endMin")
                        timeRange = String.format("%02d:%02d - %02d:%02d", startHour, startMin, endHour, endMin)
                    }
                    
                    val subheading = taskObj.optString("subheading", "")
                    val isFocus = (timeRange != null) || subheading.contains("Focus") || subheading.contains("⏱️")
                    val resolvedCategory = if (isFocus) "FOCUS BLOCKS" else "FLOATING MICRO-TASKS"
                    
                    val resolvedSubCategory = if (subheading.isNotEmpty() && !subheading.contains("Floating") && !subheading.contains("Focus")) {
                        // Strip the leading emoji if present for cleaner header display
                        subheading.replace(Regex("^[\\p{So}\\p{Cn}]\\s*"), "").trim()
                    } else {
                        null
                    }

                    val projectVal = if (taskObj.isNull("project")) "" else taskObj.optString("project", "")
                    val project = if (projectVal.isEmpty() || projectVal == "null") null else projectVal
                    tasks.add(
                        Task(
                            id = id,
                            text = text,
                            isCompleted = isCompleted,
                            notePath = getResolvedPathOrEndpoint(),
                            lineNumber = if (taskObj.has("lineIndex")) taskObj.optInt("lineIndex") + 1 else i + 1,
                            timeRange = timeRange,
                            displayTitle = text,
                            category = resolvedCategory,
                            subCategory = resolvedSubCategory,
                            project = project
                        )
                    )
                }
            }

            if (dateHeader != null) {
                prefs.lastSyncDateHeader = dateHeader
            }

            taskDao.clearTasks()
            if (tasks.isNotEmpty()) {
                taskDao.insertTasks(tasks)
                prefs.addLog("Parsed ${tasks.size} tasks from JSON endpoint.")
            } else {
                prefs.addLog("Found no active to-do items inside JSON payload.")
            }
        } catch (e: Exception) {
            prefs.addLog("Failed to parse JSON schema: ${e.message}. Ensuring robust backup parsing...")
            // Fallback: search for markdown lines directly inside the json payload if it's raw text
            parseAndSaveMarkdown(jsonContent)
        }
    }

    suspend fun toggleTask(task: Task, isCompleted: Boolean): Boolean {
        prefs.addLog("Toggling task [${task.text}] to: $isCompleted")

        // Update locally in database first for snappy user interactions
        taskDao.updateTaskStatus(task.id, isCompleted)
        triggerWidgetUpdate()

        if (prefs.syncMode == "MARKDOWN") {
            // Markdown file editing
            val base = getBaseUrl()
            val endpoint = getResolvedPathOrEndpoint()
            val formattedEndpoint = if (endpoint.startsWith("/")) endpoint else "/$endpoint"
            val fileUrl = "$base$formattedEndpoint"

            // 1. Fetch current file content
            val requestBuilder = Request.Builder().url(fileUrl).get()
            if (prefs.apiToken.isNotEmpty()) {
                requestBuilder.addHeader("Authorization", "Bearer ${prefs.apiToken}")
                requestBuilder.addHeader("X-API-Key", prefs.apiToken)
            }

            try {
                val response = client.newCall(requestBuilder.build()).execute()
                if (!response.isSuccessful) {
                    prefs.addLog("Failed remote state fetch on toggle: HTTP ${response.code}")
                    return false
                }
                var content = response.body?.string() ?: ""
                val lines = content.split(Regex("\\r?\\n")).toMutableList()

                // 2. Identify the line to alter
                var targetLineIndex = task.lineNumber - 1
                if (targetLineIndex in lines.indices) {
                    var currentLine = lines[targetLineIndex]
                    // Verify if line still matches to avoid misalignment
                    if (currentLine.contains(task.text)) {
                        val replacementChar = if (isCompleted) "x" else " "
                        currentLine = currentLine.replaceFirst(Regex("\\[[\\s*xX]?\\]"), "[$replacementChar]")
                        lines[targetLineIndex] = currentLine
                    } else {
                        // Scan file for any other matching task line to dynamically resolve drift
                        var resolved = false
                        for ((idx, line) in lines.withIndex()) {
                            if (line.contains(task.text) && line.contains("[") && line.contains("]")) {
                                val replacementChar = if (isCompleted) "x" else " "
                                lines[idx] = line.replaceFirst(Regex("\\[[\\s*xX]?\\]"), "[$replacementChar]")
                                resolved = true
                                break
                            }
                        }
                        if (!resolved) {
                            prefs.addLog("Warning: Could not identify matching task line remotely on toggle.")
                            return false
                        }
                    }
                } else {
                    prefs.addLog("Warning: Line indices shifted. Doing backup text scan.")
                    var resolved = false
                    for ((idx, line) in lines.withIndex()) {
                        if (line.contains(task.text) && line.contains("[") && line.contains("]")) {
                            val replacementChar = if (isCompleted) "x" else " "
                            lines[idx] = line.replaceFirst(Regex("\\[[\\s*xX]?\\]"), "[$replacementChar]")
                            resolved = true
                            break
                        }
                    }
                    if (!resolved) {
                        prefs.addLog("Error: Match not found.")
                        return false
                    }
                }

                // 3. Put modified content back
                val updatedContent = lines.joinToString("\n")
                val mediaType = "text/markdown; charset=utf-8".toMediaTypeOrNull()
                val putBody = updatedContent.toRequestBody(mediaType)
                
                val putRequestBuilder = Request.Builder()
                    .url(fileUrl)
                    .put(putBody)

                if (prefs.apiToken.isNotEmpty()) {
                    putRequestBuilder.addHeader("Authorization", "Bearer ${prefs.apiToken}")
                    putRequestBuilder.addHeader("X-API-Key", prefs.apiToken)
                }

                val putResponse = client.newCall(putRequestBuilder.build()).execute()
                if (putResponse.isSuccessful) {
                    prefs.addLog("Successfully synced toggled task status to PC.")
                    // Trigger double sync to fully align other states
                    syncTasks()
                    return true
                } else {
                    prefs.addLog("Failed uploading changes: HTTP ${putResponse.code}. Reverting local task state.")
                    taskDao.updateTaskStatus(task.id, !isCompleted)
                    triggerWidgetUpdate()
                    return false
                }
            } catch (e: Exception) {
                prefs.addLog("Network toggle failure: ${e.message}. Reverting state.")
                taskDao.updateTaskStatus(task.id, !isCompleted)
                triggerWidgetUpdate()
                return false
            }
        } else {
            // JSON toggle model:
            val base = getBaseUrl()
            val endpoint = getResolvedPathOrEndpoint()
            val formattedEndpoint = if (endpoint.startsWith("/")) endpoint else "/$endpoint"
            
            // Try updating task item endpoint for Obsidian custom plugin
            val fileUrl = "$base/api/task/toggle"
            val payload = JSONObject().apply {
                put("lineIndex", task.lineNumber - 1)
                put("complete", isCompleted)
            }

            val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
            val postBody = payload.toString().toRequestBody(mediaType)
            
            val postRequest = Request.Builder()
                .url(fileUrl)
                .post(postBody)

            if (prefs.apiToken.isNotEmpty()) {
                postRequest.addHeader("Authorization", "Bearer ${prefs.apiToken}")
                postRequest.addHeader("X-API-Key", prefs.apiToken)
            }

            try {
                val response = client.newCall(postRequest.build()).execute()
                if (response.isSuccessful) {
                    prefs.addLog("Successfully synced toggled JSON task status.")
                    syncTasks()
                    return true
                } else {
                    // Try alternative PUT directly to task.id (fallback)
                    val altUrl = "$base$formattedEndpoint/${task.id}"
                    val altPayload = JSONObject().apply {
                        put("id", task.id)
                        put("completed", isCompleted)
                        put("text", task.text)
                    }
                    val altBody = altPayload.toString().toRequestBody(mediaType)
                    val altRequest = Request.Builder()
                        .url(altUrl)
                        .put(altBody)
                    
                    if (prefs.apiToken.isNotEmpty()) {
                        altRequest.addHeader("Authorization", "Bearer ${prefs.apiToken}")
                    }

                    val altResponse = client.newCall(altRequest.build()).execute()
                    if (altResponse.isSuccessful) {
                        prefs.addLog("Synced via relative item-level PUT endpoint.")
                        syncTasks()
                        return true
                    } else {
                        prefs.addLog("JSON toggle failed: API mismatch (code ${response.code}). Reverting.")
                        taskDao.updateTaskStatus(task.id, !isCompleted)
                        triggerWidgetUpdate()
                        return false
                    }
                }
            } catch (e: Exception) {
                prefs.addLog("JSON sync toggle network error: ${e.message}. Reverting.")
                taskDao.updateTaskStatus(task.id, !isCompleted)
                triggerWidgetUpdate()
                return false
            }
        }
    }

    suspend fun generateSchedule(): Boolean {
        prefs.addLog("Triggering schedule generation...")
        val base = getBaseUrl()
        val url = "$base/api/schedule/generate"
        prefs.addLog("Generate URL: $url")

        val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
        val requestBody = "{}".toRequestBody(mediaType)
        val requestBuilder = Request.Builder()
            .url(url)
            .post(requestBody)

        if (prefs.apiToken.isNotEmpty()) {
            requestBuilder.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            requestBuilder.addHeader("X-API-Key", prefs.apiToken)
        }

        try {
            val response = client.newCall(requestBuilder.build()).execute()
            if (response.isSuccessful) {
                prefs.addLog("Schedule generation triggered successfully.")
                return true
            } else {
                prefs.addLog("Failed to trigger schedule generation: HTTP ${response.code}")
                return false
            }
        } catch (e: Exception) {
            prefs.addLog("Error triggering generation: ${e.message}")
            return false
        }
    }

    private fun parseAndSaveActiveTimerObj(obj: JSONObject) {
        try {
            if (obj.has("activeTimer") && !obj.isNull("activeTimer")) {
                val timerObj = obj.getJSONObject("activeTimer")
                prefs.activeTimerTaskName = timerObj.optString("taskName", "")
                prefs.activeTimerRemainingSeconds = timerObj.optInt("remainingSeconds", 0)
                prefs.activeTimerTotalSeconds = timerObj.optInt("totalSeconds", 0)
                prefs.activeTimerIsPaused = timerObj.optBoolean("isPaused", false)
                val rawLineIdx = timerObj.optInt("lineIndex", -1)
                prefs.activeTimerLineIndex = if (rawLineIdx >= 0) rawLineIdx + 1 else -1
            } else {
                clearActiveTimerPrefs()
            }
            prefs.isAlarming = obj.optBoolean("isAlarming", false)
            com.example.widget.TimerService.checkAndSyncTimerService(context)
            triggerWidgetUpdate()
        } catch (e: Exception) {
            Log.e("SyncRepository", "Error parsing active timer: ${e.message}")
            clearActiveTimerPrefs()
            com.example.widget.TimerService.checkAndSyncTimerService(context)
            triggerWidgetUpdate()
        }
    }

    private fun clearActiveTimerPrefs() {
        prefs.activeTimerTaskName = ""
        prefs.activeTimerRemainingSeconds = 0
        prefs.activeTimerTotalSeconds = 0
        prefs.activeTimerIsPaused = false
        prefs.activeTimerLineIndex = -1
        prefs.isAlarming = false
    }

    suspend fun syncActiveTimer(): Boolean {
        val base = getBaseUrl()
        val url = "$base/api/status"
        val requestBuilder = Request.Builder().url(url).get()
        if (prefs.apiToken.isNotEmpty()) {
            requestBuilder.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            requestBuilder.addHeader("X-API-Key", prefs.apiToken)
        }
        try {
            val response = client.newCall(requestBuilder.build()).execute()
            if (response.isSuccessful) {
                val body = response.body?.string() ?: ""
                val obj = JSONObject(body)
                parseAndSaveActiveTimerObj(obj)
                return true
            }
        } catch (e: Exception) {
            Log.e("SyncRepository", "Failed to sync active timer: ${e.message}")
        }
        return false
    }

    suspend fun startTimer(task: Task, durationMinutes: Int? = null): Boolean {
        prefs.addLog("Starting timer for: ${task.text} (${durationMinutes ?: "default"}m)")
        val base = getBaseUrl()
        val url = "$base/api/timer/start"
        val payload = JSONObject().apply {
            put("lineIndex", task.lineNumber - 1)
            if (durationMinutes != null) {
                put("durationMinutes", durationMinutes)
            }
        }
        val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
        val body = payload.toString().toRequestBody(mediaType)
        val request = Request.Builder().url(url).post(body)
        if (prefs.apiToken.isNotEmpty()) {
            request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            request.addHeader("X-API-Key", prefs.apiToken)
        }
        try {
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                prefs.addLog("Timer started successfully.")
                syncActiveTimer()
                return true
            } else {
                prefs.addLog("Failed to start timer: HTTP ${response.code}")
            }
        } catch (e: Exception) {
            prefs.addLog("Network error starting timer: ${e.message}")
        }
        return false
    }

    suspend fun cancelTimer(): Boolean {
        prefs.addLog("Canceling active timer...")
        val base = getBaseUrl()
        val url = "$base/api/timer/cancel"
        val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
        val body = "{}".toRequestBody(mediaType)
        val request = Request.Builder().url(url).post(body)
        if (prefs.apiToken.isNotEmpty()) {
            request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            request.addHeader("X-API-Key", prefs.apiToken)
        }
        try {
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                prefs.addLog("Timer canceled successfully.")
                syncActiveTimer()
                return true
            } else {
                prefs.addLog("Failed to cancel timer: HTTP ${response.code}")
            }
        } catch (e: Exception) {
            prefs.addLog("Network error canceling timer: ${e.message}")
        }
        return false
    }

    suspend fun pauseTimer(): Boolean {
        prefs.addLog("Pausing timer...")
        val base = getBaseUrl()
        val url = "$base/api/timer/pause"
        val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
        val body = "{}".toRequestBody(mediaType)
        val request = Request.Builder().url(url).post(body)
        if (prefs.apiToken.isNotEmpty()) {
            request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            request.addHeader("X-API-Key", prefs.apiToken)
        }
        try {
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                prefs.addLog("Timer paused.")
                syncActiveTimer()
                return true
            }
        } catch (e: Exception) {
            prefs.addLog("Network error pausing timer: ${e.message}")
        }
        return false
    }

    suspend fun resumeTimer(): Boolean {
        prefs.addLog("Resuming timer...")
        val base = getBaseUrl()
        val url = "$base/api/timer/resume"
        val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
        val body = "{}".toRequestBody(mediaType)
        val request = Request.Builder().url(url).post(body)
        if (prefs.apiToken.isNotEmpty()) {
            request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            request.addHeader("X-API-Key", prefs.apiToken)
        }
        try {
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                prefs.addLog("Timer resumed.")
                syncActiveTimer()
                return true
            }
        } catch (e: Exception) {
            prefs.addLog("Network error resuming timer: ${e.message}")
        }
        return false
    }

    suspend fun completeTimer(): Boolean {
        prefs.addLog("Completing active task timer...")
        val base = getBaseUrl()
        val url = "$base/api/timer/complete"
        val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
        val body = "{}".toRequestBody(mediaType)
        val request = Request.Builder().url(url).post(body)
        if (prefs.apiToken.isNotEmpty()) {
            request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            request.addHeader("X-API-Key", prefs.apiToken)
        }
        try {
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                prefs.addLog("Active task timer completed.")
                syncTasks()
                return true
            }
        } catch (e: Exception) {
            prefs.addLog("Network error completing timer: ${e.message}")
        }
        return false
    }

    suspend fun postponeTask(task: Task): Boolean {
        prefs.addLog("Postponing task: ${task.text}")
        val base = getBaseUrl()
        val url = "$base/api/task/postpone"
        val payload = JSONObject().apply {
            put("lineIndex", task.lineNumber - 1)
            put("description", task.displayTitle)
        }
        val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
        val body = payload.toString().toRequestBody(mediaType)
        val request = Request.Builder().url(url).post(body)
        if (prefs.apiToken.isNotEmpty()) {
            request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            request.addHeader("X-API-Key", prefs.apiToken)
        }
        try {
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                prefs.addLog("Task postponed successfully.")
                syncTasks()
                return true
            } else {
                prefs.addLog("Failed to postpone task: HTTP ${response.code}")
            }
        } catch (e: Exception) {
            prefs.addLog("Network error postponing task: ${e.message}")
        }
        return false
    }

    suspend fun skipTask(task: Task): Boolean {
        prefs.addLog("Skipping task for today: ${task.text}")
        val base = getBaseUrl()
        val url = "$base/api/task/nottoday"
        val payload = JSONObject().apply {
            put("lineIndex", task.lineNumber - 1)
            put("description", task.displayTitle)
        }
        val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
        val body = payload.toString().toRequestBody(mediaType)
        val request = Request.Builder().url(url).post(body)
        if (prefs.apiToken.isNotEmpty()) {
            request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            request.addHeader("X-API-Key", prefs.apiToken)
        }
        try {
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                prefs.addLog("Task skipped successfully.")
                syncTasks()
                return true
            } else {
                prefs.addLog("Failed to skip task: HTTP ${response.code}")
            }
        } catch (e: Exception) {
            prefs.addLog("Network error skipping task: ${e.message}")
        }
        return false
    }

    suspend fun dropTask(task: Task, targetSubheading: String): Boolean {
        prefs.addLog("Moving task: ${task.text} to $targetSubheading")
        val base = getBaseUrl()
        val url = "$base/api/task/drop"
        val payload = JSONObject().apply {
            put("draggedTask", JSONObject().apply {
                put("lineIndex", task.lineNumber - 1)
                put("description", task.text)
                put("isUntimed", task.category != "FOCUS BLOCKS")
            })
            put("targetSubheading", targetSubheading)
        }
        val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
        val body = payload.toString().toRequestBody(mediaType)
        val request = Request.Builder().url(url).post(body)
        if (prefs.apiToken.isNotEmpty()) {
            request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            request.addHeader("X-API-Key", prefs.apiToken)
        }
        try {
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                prefs.addLog("Task moved successfully.")
                syncTasks()
                return true
            } else {
                prefs.addLog("Failed to move task: HTTP ${response.code}")
            }
        } catch (e: Exception) {
            prefs.addLog("Network error moving task: ${e.message}")
        }
        return false
    }

    private fun triggerWidgetUpdate() {
        try {
            val app = context.applicationContext
            val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                component = ComponentName(app, "com.example.widget.ObsidianTodoWidgetProvider")
            }
            app.sendBroadcast(intent)
        } catch (e: Exception) {
            Log.e("SyncRepository", "Widget trigger broadcast error: ${e.message}")
        }
    }
}
