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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class HabitItem(
    val name: String,
    val completed: Boolean,
    val section: String,
    val rowIdx: Int
)

class ObsidianSyncRepository(private val context: Context) {
    private val db = AppDatabase.getDatabase(context)
    private val taskDao = db.taskDao()
    private val prefs = SyncPreferences(context)

    private val _todayHabits = MutableStateFlow<Map<String, List<HabitItem>>>(emptyMap())
    val todayHabits: StateFlow<Map<String, List<HabitItem>>> = _todayHabits

    private val _availableAudioTracks = MutableStateFlow<List<FocusAudioTrack>>(emptyList())
    val availableAudioTracks: StateFlow<List<FocusAudioTrack>> = _availableAudioTracks

    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()

    fun getAllTasksFlow() = taskDao.getAllTasks()

    suspend fun getLocalTasks() = taskDao.getAllTasksDirect()

    fun getBaseUrl(): String {
        var ip = prefs.serverIp.trim().replace(" ", "")
        val port = prefs.serverPort.trim().replace(" ", "")
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
        try {
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

        var lastParentTask: Task? = null

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
                val isIndented = indent.isNotEmpty()

                // Check for a time range signature (e.g. "18:30 - 19:00")
                val timeRangeMatch = timeRangeRegex.find(text)
                val (timeRange, displayTitle) = if (timeRangeMatch != null) {
                    val tr = timeRangeMatch.groupValues[1]
                    val cleanText = text.replace(tr, "").replace(Regex("^\\s*-\\s*"), "").trim()
                    Pair(tr, cleanText)
                } else {
                    Pair(null, text)
                }

                // Determine category and project
                val resolvedCategory: String
                var projectVal = currentProject ?: ""
                
                if (timeRange != null) {
                    resolvedCategory = "FOCUS BLOCKS"
                    if (projectVal.isEmpty() || projectVal == "null") {
                        projectVal = displayTitle
                    }
                } else if (isIndented && lastParentTask != null && lastParentTask.category == "FOCUS BLOCKS") {
                    resolvedCategory = "FOCUS BLOCKS"
                    projectVal = lastParentTask.project ?: lastParentTask.displayTitle
                } else {
                    resolvedCategory = currentCategory
                }

                val resolvedParentLineNumber = if (isIndented && lastParentTask != null) {
                    lastParentTask.lineNumber
                } else {
                    null
                }

                val stableId = "md_${getResolvedPathOrEndpoint().hashCode()}_${index}_${text.hashCode()}"

                val newTask = Task(
                    id = stableId,
                    text = text,
                    isCompleted = isCompleted,
                    notePath = getResolvedPathOrEndpoint(),
                    lineNumber = index + 1, // 1-based index
                    parentLineNumber = resolvedParentLineNumber,
                    rawMarkdownLine = line,
                    timeRange = timeRange,
                    displayTitle = displayTitle,
                    category = resolvedCategory,
                    subCategory = currentSubCategory,
                    project = if (projectVal.isEmpty() || projectVal == "null") null else projectVal
                )
                parsedTasks.add(newTask)

                if (!isIndented) {
                    lastParentTask = newTask
                }
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
                    
                    val rawParentIdx = taskObj.optInt("parentLineIndex", -1)
                    val parentLineNum = if (rawParentIdx >= 0) rawParentIdx + 1 else if (taskObj.has("parentLineNumber") && !taskObj.isNull("parentLineNumber")) taskObj.optInt("parentLineNumber") else null

                    tasks.add(
                        Task(
                            id = id,
                            text = text,
                            isCompleted = isCompleted,
                            notePath = getResolvedPathOrEndpoint(),
                            lineNumber = if (taskObj.has("lineIndex")) taskObj.optInt("lineIndex") + 1 else i + 1,
                            parentLineNumber = parentLineNum,
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
                put("description", task.displayTitle.ifEmpty { task.text })
                put("text", task.text)
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
                val remainingSecs = timerObj.optInt("remainingSeconds", 0)
                prefs.activeTimerRemainingSeconds = remainingSecs
                prefs.activeTimerTotalSeconds = timerObj.optInt("totalSeconds", 0)
                val isPaused = timerObj.optBoolean("isPaused", false)
                prefs.activeTimerIsPaused = isPaused
                
                val serverNow = obj.optLong("serverNow", 0L)
                val targetEnd = timerObj.optLong("targetEndTime", 0L)
                if (targetEnd > 0L && !isPaused) {
                    if (serverNow > 0L) {
                        // Eliminate clock skew drift between PC host and Android device
                        val clockSkew = System.currentTimeMillis() - serverNow
                        prefs.activeTimerTargetEndTime = targetEnd + clockSkew
                    } else {
                        prefs.activeTimerTargetEndTime = System.currentTimeMillis() + (remainingSecs * 1000L)
                    }
                } else if (!isPaused && remainingSecs > 0) {
                    prefs.activeTimerTargetEndTime = System.currentTimeMillis() + (remainingSecs * 1000L)
                } else {
                    prefs.activeTimerTargetEndTime = 0L
                }

                val rawLineIdx = timerObj.optInt("lineIndex", -1)
                prefs.activeTimerLineIndex = if (rawLineIdx >= 0) rawLineIdx + 1 else -1

                val itemsArray = timerObj.optJSONArray("items")
                if (itemsArray != null && itemsArray.length() > 0) {
                    val list = mutableListOf<String>()
                    for (i in 0 until itemsArray.length()) {
                        list.add(itemsArray.getString(i))
                    }
                    prefs.activeTimerItems = JSONArray(list).toString()
                } else {
                    prefs.activeTimerItems = ""
                }
            } else {
                clearActiveTimerPrefs()
            }
            if (obj.has("focusAudio") && !obj.isNull("focusAudio")) {
                val audioObj = obj.getJSONObject("focusAudio")
                if (audioObj.has("currentTrack") && !audioObj.isNull("currentTrack")) {
                    val trackObj = audioObj.getJSONObject("currentTrack")
                    val label = trackObj.optString("label", "")
                    val url = trackObj.optString("url", "")
                    val streamUrl = trackObj.optString("streamUrl", "")
                    val type = trackObj.optString("type", "external_web")
                    if (label.isNotEmpty()) {
                        prefs.selectedAudioTrackLabel = label
                        prefs.selectedAudioTrackUrl = url
                        prefs.selectedAudioTrackStreamUrl = streamUrl
                        prefs.selectedAudioTrackType = type
                    }
                }
                val desktopPlaying = audioObj.optBoolean("isPlaying", false)
                prefs.isDesktopAudioPlaying = desktopPlaying
                if (audioObj.has("autoSyncWithTimer")) {
                    prefs.isAudioAutoSyncEnabled = audioObj.optBoolean("autoSyncWithTimer", true)
                }
                if (audioObj.has("volume")) {
                    prefs.focusAudioVolume = audioObj.optDouble("volume", 0.8).toFloat()
                }
                if (prefs.activeTimerIsPaused || prefs.activeTimerTaskName.isEmpty()) {
                    prefs.isPhoneAudioPlaying = false
                }
            }
            if (obj.has("todayHabits") && !obj.isNull("todayHabits")) {
                val habitsObj = obj.getJSONObject("todayHabits")
                val parsedHabits = mutableMapOf<String, List<HabitItem>>()
                val sections = listOf("morning", "work", "house")
                for (sec in sections) {
                    if (habitsObj.has(sec)) {
                        val arr = habitsObj.optJSONArray(sec)
                        if (arr != null) {
                            val list = mutableListOf<HabitItem>()
                            for (i in 0 until arr.length()) {
                                val itemObj = arr.getJSONObject(i)
                                list.add(
                                    HabitItem(
                                        name = itemObj.optString("name", ""),
                                        completed = itemObj.optBoolean("completed", false),
                                        section = itemObj.optString("sectionKey", sec),
                                        rowIdx = itemObj.optInt("rowIdx", i)
                                    )
                                )
                            }
                            parsedHabits[sec] = list
                        }
                    }
                }
                _todayHabits.value = parsedHabits
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

    suspend fun toggleHabit(section: String, habitName: String, completed: Boolean): Boolean {
        prefs.addLog("Toggling weekly habit [$habitName] in $section to: $completed")

        val current = _todayHabits.value.toMutableMap()
        val secList = current[section]?.toMutableList() ?: mutableListOf()
        val idx = secList.indexOfFirst { it.name == habitName }
        if (idx != -1) {
            secList[idx] = secList[idx].copy(completed = completed)
            current[section] = secList
            _todayHabits.value = current
        }

        val base = getBaseUrl()
        val url = "$base/api/habit/toggle"
        val payload = JSONObject().apply {
            put("section", section)
            put("name", habitName)
            put("completed", completed)
        }
        val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
        val postBody = payload.toString().toRequestBody(mediaType)
        val postRequest = Request.Builder().url(url).post(postBody)
        if (prefs.apiToken.isNotEmpty()) {
            postRequest.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            postRequest.addHeader("X-API-Key", prefs.apiToken)
        }

        try {
            val response = client.newCall(postRequest.build()).execute()
            if (response.isSuccessful) {
                prefs.addLog("Successfully synced habit [$habitName].")
                syncActiveTimer()
                return true
            } else {
                prefs.addLog("Failed toggling habit: HTTP ${response.code}. Reverting.")
                if (idx != -1) {
                    secList[idx] = secList[idx].copy(completed = !completed)
                    current[section] = secList
                    _todayHabits.value = current
                }
                return false
            }
        } catch (e: Exception) {
            prefs.addLog("Error toggling habit: ${e.message}. Reverting.")
            if (idx != -1) {
                secList[idx] = secList[idx].copy(completed = !completed)
                current[section] = secList
                _todayHabits.value = current
            }
            return false
        }
    }

    private fun clearActiveTimerPrefs() {
        prefs.activeTimerTaskName = ""
        prefs.activeTimerRemainingSeconds = 0
        prefs.activeTimerTotalSeconds = 0
        prefs.activeTimerIsPaused = false
        prefs.activeTimerTargetEndTime = 0L
        prefs.activeTimerLineIndex = -1
        prefs.activeTimerItems = ""
        prefs.isAlarming = false
    }

    suspend fun syncActiveTimer(): Boolean {
        try {
            val base = getBaseUrl()
            val url = "$base/api/status"
            val requestBuilder = Request.Builder().url(url).get()
            if (prefs.apiToken.isNotEmpty()) {
                requestBuilder.addHeader("Authorization", "Bearer ${prefs.apiToken}")
                requestBuilder.addHeader("X-API-Key", prefs.apiToken)
            }
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
        val taskTitle = task.displayTitle.ifEmpty { task.text }
        prefs.addLog("Starting timer for: $taskTitle (${durationMinutes ?: "default"}m)")
        val base = getBaseUrl()
        val url = "$base/api/timer/start"
        val payload = JSONObject().apply {
            if (task.lineNumber > 0) {
                put("lineIndex", task.lineNumber - 1)
            }
            put("taskName", taskTitle)
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

    suspend fun startTimer(taskName: String, durationMinutes: Int = 15): Boolean {
        prefs.addLog("Starting timer for habit/taskName: $taskName (${durationMinutes}m)")
        val base = getBaseUrl()
        val url = "$base/api/timer/start"
        val payload = JSONObject().apply {
            put("taskName", taskName)
            put("durationMinutes", durationMinutes)
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

    suspend fun fetchAudioTracks(): List<FocusAudioTrack> {
        val base = getBaseUrl()
        val url = "$base/api/audio/tracks"
        val request = Request.Builder().url(url).get()
        if (prefs.apiToken.isNotEmpty()) {
            request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
            request.addHeader("X-API-Key", prefs.apiToken)
        }
        try {
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                val jsonStr = response.body?.string() ?: ""
                val obj = JSONObject(jsonStr)
                if (obj.optBoolean("success", false)) {
                    val arr = obj.optJSONArray("tracks") ?: JSONArray()
                    val list = mutableListOf<FocusAudioTrack>()
                    for (i in 0 until arr.length()) {
                        val item = arr.getJSONObject(i)
                        val rawStreamUrl = if (item.has("streamUrl") && !item.isNull("streamUrl")) item.getString("streamUrl") else null
                        val resolvedStreamUrl = when {
                            rawStreamUrl != null && rawStreamUrl.contains("127.0.0.1:8090") -> rawStreamUrl.replace("http://127.0.0.1:8090", base)
                            rawStreamUrl != null && rawStreamUrl.startsWith("http") -> rawStreamUrl
                            item.optString("type") == "local" -> "$base/api/audio/stream?file=${android.net.Uri.encode(item.optString("url"))}"
                            else -> rawStreamUrl
                        }
                        list.add(
                            FocusAudioTrack(
                                label = item.optString("label", ""),
                                url = item.optString("url", ""),
                                streamUrl = resolvedStreamUrl,
                                type = item.optString("type", "local"),
                                isInternal = item.optBoolean("isInternal", false),
                                videoId = if (item.has("videoId") && !item.isNull("videoId")) item.getString("videoId") else null,
                                playlistId = if (item.has("playlistId") && !item.isNull("playlistId")) item.getString("playlistId") else null
                            )
                        )
                    }
                    _availableAudioTracks.value = list

                    if (obj.has("currentTrack") && !obj.isNull("currentTrack")) {
                        val curTrack = obj.getJSONObject("currentTrack")
                        val curLabel = curTrack.optString("label", "")
                        if (curLabel.isNotEmpty()) {
                            prefs.selectedAudioTrackLabel = curLabel
                            prefs.selectedAudioTrackUrl = curTrack.optString("url", "")
                            prefs.selectedAudioTrackStreamUrl = curTrack.optString("streamUrl", "")
                            prefs.selectedAudioTrackType = curTrack.optString("type", "external_web")
                        }
                    }
                    if (prefs.activeTimerIsPaused || prefs.activeTimerTaskName.isEmpty()) {
                        prefs.isPhoneAudioPlaying = false
                    }
                    return list
                }
            }
        } catch (e: Exception) {
            Log.e("SyncRepository", "Error fetching audio tracks: ${e.message}")
        }
        return _availableAudioTracks.value
    }

    suspend fun selectAudioTrackOnDesktop(label: String, url: String, type: String): Boolean {
        try {
            val base = getBaseUrl()
            val targetUrl = "$base/api/audio/select"
            val payload = JSONObject().apply {
                put("label", label)
                put("url", url)
                put("type", type)
            }
            val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
            val body = payload.toString().toRequestBody(mediaType)
            val request = Request.Builder().url(targetUrl).post(body)
            if (prefs.apiToken.isNotEmpty()) {
                request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
                request.addHeader("X-API-Key", prefs.apiToken)
            }
            val response = client.newCall(request.build()).execute()
            return response.isSuccessful
        } catch (e: Exception) {
            Log.e("SyncRepository", "Error selecting audio track on desktop: ${e.message}")
        }
        return false
    }

    suspend fun toggleDesktopAudio(): Boolean {
        try {
            val base = getBaseUrl()
            val targetUrl = "$base/api/audio/toggle"
            val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
            val body = "{}".toRequestBody(mediaType)
            val request = Request.Builder().url(targetUrl).post(body)
            if (prefs.apiToken.isNotEmpty()) {
                request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
                request.addHeader("X-API-Key", prefs.apiToken)
            }
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                val json = JSONObject(response.body?.string() ?: "{}")
                val isPlaying = json.optBoolean("isPlaying", false)
                prefs.isDesktopAudioPlaying = isPlaying
                return isPlaying
            }
        } catch (e: Exception) {
            Log.e("SyncRepository", "Error toggling desktop audio: ${e.message}")
        }
        return false
    }

    suspend fun stopDesktopAudio(): Boolean {
        try {
            val base = getBaseUrl()
            val targetUrl = "$base/api/audio/stop"
            val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
            val body = "{}".toRequestBody(mediaType)
            val request = Request.Builder().url(targetUrl).post(body)
            if (prefs.apiToken.isNotEmpty()) {
                request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
                request.addHeader("X-API-Key", prefs.apiToken)
            }
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                prefs.isDesktopAudioPlaying = false
                return true
            }
        } catch (e: Exception) {
            Log.e("SyncRepository", "Error stopping desktop audio: ${e.message}")
        }
        return false
    }

    suspend fun setDesktopAudioVolume(volume: Float): Boolean {
        try {
            val base = getBaseUrl()
            val targetUrl = "$base/api/audio/volume"
            val payload = JSONObject().apply {
                put("volume", volume.toDouble())
            }
            val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
            val body = payload.toString().toRequestBody(mediaType)
            val request = Request.Builder().url(targetUrl).post(body)
            if (prefs.apiToken.isNotEmpty()) {
                request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
                request.addHeader("X-API-Key", prefs.apiToken)
            }
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                prefs.focusAudioVolume = volume
                return true
            }
        } catch (e: Exception) {
            Log.e("SyncRepository", "Error setting desktop audio volume: ${e.message}")
        }
        return false
    }

    suspend fun setDesktopAudioAutoSync(enabled: Boolean): Boolean {
        try {
            val base = getBaseUrl()
            val targetUrl = "$base/api/audio/autosync"
            val payload = JSONObject().apply {
                put("enabled", enabled)
            }
            val mediaType = "application/json; charset=utf-8".toMediaTypeOrNull()
            val body = payload.toString().toRequestBody(mediaType)
            val request = Request.Builder().url(targetUrl).post(body)
            if (prefs.apiToken.isNotEmpty()) {
                request.addHeader("Authorization", "Bearer ${prefs.apiToken}")
                request.addHeader("X-API-Key", prefs.apiToken)
            }
            val response = client.newCall(request.build()).execute()
            if (response.isSuccessful) {
                prefs.isAudioAutoSyncEnabled = enabled
                return true
            }
        } catch (e: Exception) {
            Log.e("SyncRepository", "Error setting desktop audio autoSync: ${e.message}")
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

    suspend fun deleteTask(task: Task): Boolean {
        prefs.addLog("Deleting task block: ${task.text}")
        taskDao.deleteTask(task.id)
        triggerWidgetUpdate()
        val base = getBaseUrl()
        val url = "$base/api/task/delete"
        val payload = JSONObject().apply {
            put("lineIndex", task.lineNumber - 1)
            put("description", task.displayTitle.ifEmpty { task.text })
            put("text", task.text)
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
                prefs.addLog("Task deleted successfully.")
                syncTasks()
                return true
            } else {
                prefs.addLog("Remote delete response: HTTP ${response.code}")
                syncTasks()
            }
        } catch (e: Exception) {
            prefs.addLog("Network error deleting task: ${e.message}")
            syncTasks()
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

    suspend fun quickLog(foodId: String): Boolean {
        prefs.addLog("Quick-logging food item: $foodId")
        val base = getBaseUrl()
        val url = "$base/api/quicklog"
        val payload = JSONObject().apply {
            put("foodId", foodId)
            put("amount", 1)
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
                prefs.addLog("Quick-logged $foodId successfully.")
                return true
            } else {
                prefs.addLog("Failed to quick-log food: HTTP ${response.code}")
            }
        } catch (e: Exception) {
            prefs.addLog("Network error quick-logging: ${e.message}")
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
