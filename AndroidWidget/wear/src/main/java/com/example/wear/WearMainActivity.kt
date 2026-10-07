package com.example.wear

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.*
import com.google.android.gms.wearable.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject

data class WatchScheduleBlock(
    val id: String,
    val title: String,
    val time: String,
    val isCompleted: Boolean,
    val category: String
)

class WearMainActivity : ComponentActivity(), DataClient.OnDataChangedListener, MessageClient.OnMessageReceivedListener {

    private var taskName by mutableStateOf("No task selected")
    private var remainingSeconds by mutableIntStateOf(0)
    private var totalSeconds by mutableIntStateOf(0)
    private var isPaused by mutableStateOf(false)
    private var isAlarming by mutableStateOf(false)
    private var timerItems by mutableStateOf<List<String>>(emptyList())
    private var scheduleBlocks by mutableStateOf<List<WatchScheduleBlock>>(emptyList())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            WearAppTheme {
                WearTimerScreen(
                    taskName = taskName,
                    remainingSeconds = remainingSeconds,
                    isPaused = isPaused,
                    isAlarming = isAlarming,
                    timerItems = timerItems,
                    scheduleBlocks = scheduleBlocks,
                    onPauseResumeClick = { sendControlMessage(if (isPaused) "/resume" else "/pause") },
                    onCancelClick = { sendControlMessage("/cancel") },
                    onStartBlockClick = { block ->
                        triggerVibration()
                        Toast.makeText(this@WearMainActivity, "Starting ${block.title}...", Toast.LENGTH_SHORT).show()
                        val encodedTitle = Uri.encode(block.title)
                        sendControlMessage("/start_task/$encodedTitle")
                    },
                    onRequestSyncClick = {
                        triggerVibration()
                        Toast.makeText(this@WearMainActivity, "Syncing from phone...", Toast.LENGTH_SHORT).show()
                        sendControlMessage("/request_sync")
                    },
                    onQuickLogClick = { foodId ->
                        val foodName = when (foodId) {
                            "water" -> "Water"
                            "espresso" -> "Espresso"
                            "protein_waffles" -> "Waffle"
                            "protein_shake" -> "Shake"
                            "mixed_nuts" -> "Nuts"
                            else -> foodId
                        }
                        triggerVibration()
                        Toast.makeText(this@WearMainActivity, "Logging $foodName...", Toast.LENGTH_SHORT).show()
                        sendControlMessage("/quicklog/$foodId")
                    }
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        Wearable.getDataClient(this).addListener(this)
        Wearable.getMessageClient(this).addListener(this)
        loadFromPrefs()
        queryCurrentWearableData()
        sendControlMessage("/request_sync")
    }

    override fun onPause() {
        super.onPause()
        Wearable.getDataClient(this).removeListener(this)
        Wearable.getMessageClient(this).removeListener(this)
    }

    private fun loadFromPrefs() {
        val prefs = getSharedPreferences("wear_prefs", MODE_PRIVATE)
        taskName = prefs.getString("taskName", "No task selected") ?: "No task selected"
        remainingSeconds = prefs.getInt("remainingSeconds", 0)
        totalSeconds = prefs.getInt("totalSeconds", 0)
        isPaused = prefs.getBoolean("isPaused", false)
        isAlarming = prefs.getBoolean("isAlarming", false)

        val itemsJson = prefs.getString("items_json", "[]") ?: "[]"
        timerItems = parseItemsJson(itemsJson)

        val blocksJson = prefs.getString("schedule_blocks_json", "[]") ?: "[]"
        scheduleBlocks = parseScheduleBlocksJson(blocksJson)
    }

    private fun parseItemsJson(jsonStr: String): List<String> {
        val list = mutableListOf<String>()
        try {
            val arr = JSONArray(jsonStr)
            for (i in 0 until arr.length()) {
                list.add(arr.getString(i))
            }
        } catch (_: Exception) {}
        return list
    }

    private fun parseScheduleBlocksJson(jsonStr: String): List<WatchScheduleBlock> {
        val list = mutableListOf<WatchScheduleBlock>()
        try {
            val arr = JSONArray(jsonStr)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                list.add(
                    WatchScheduleBlock(
                        id = obj.optString("id", "$i"),
                        title = obj.optString("title", "Block"),
                        time = obj.optString("time", ""),
                        isCompleted = obj.optBoolean("isCompleted", false),
                        category = obj.optString("category", "")
                    )
                )
            }
        } catch (_: Exception) {}
        return list
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            if (event.type == DataEvent.TYPE_CHANGED) {
                val path = event.dataItem.uri.path
                if (path == "/timer_state") {
                    val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                    taskName = dataMap.getString("taskName", "No task selected")
                    remainingSeconds = dataMap.getInt("remainingSeconds", 0)
                    totalSeconds = dataMap.getInt("totalSeconds", 0)
                    isPaused = dataMap.getBoolean("isPaused", false)
                    isAlarming = dataMap.getBoolean("isAlarming", false)
                    val items = dataMap.getStringArrayList("items") ?: arrayListOf()
                    timerItems = items
                    Log.d("WearMainActivity", "Data changed: $taskName, $remainingSeconds, isPaused=$isPaused, items=${items.size}")

                    saveToPrefsAndUpdateTile(taskName, remainingSeconds, totalSeconds, isPaused, isAlarming, items)
                } else if (path == "/schedule_data") {
                    val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                    val blocksJson = dataMap.getString("blocksJson", "[]")
                    Log.d("WearMainActivity", "Schedule data changed: $blocksJson")
                    scheduleBlocks = parseScheduleBlocksJson(blocksJson)
                    val prefs = getSharedPreferences("wear_prefs", MODE_PRIVATE)
                    prefs.edit().putString("schedule_blocks_json", blocksJson).apply()
                    try {
                        androidx.wear.tiles.TileService.getUpdater(applicationContext)
                            .requestUpdate(WearTimerTileService::class.java)
                    } catch (_: Exception) {}
                }
            }
        }
    }

    private fun queryCurrentWearableData() {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val buffer = Wearable.getDataClient(this@WearMainActivity).dataItems.await()
                for (i in 0 until buffer.count) {
                    val item = buffer.get(i)
                    if (item.uri.path == "/timer_state") {
                        val dataMap = DataMapItem.fromDataItem(item).dataMap
                        taskName = dataMap.getString("taskName", "No task selected")
                        remainingSeconds = dataMap.getInt("remainingSeconds", 0)
                        totalSeconds = dataMap.getInt("totalSeconds", 0)
                        isPaused = dataMap.getBoolean("isPaused", false)
                        isAlarming = dataMap.getBoolean("isAlarming", false)
                        val items = dataMap.getStringArrayList("items") ?: arrayListOf()
                        timerItems = items
                        saveToPrefsAndUpdateTile(taskName, remainingSeconds, totalSeconds, isPaused, isAlarming, items)
                    } else if (item.uri.path == "/schedule_data") {
                        val dataMap = DataMapItem.fromDataItem(item).dataMap
                        val blocksJson = dataMap.getString("blocksJson", "[]")
                        scheduleBlocks = parseScheduleBlocksJson(blocksJson)
                        val prefs = getSharedPreferences("wear_prefs", MODE_PRIVATE)
                        prefs.edit().putString("schedule_blocks_json", blocksJson).apply()
                    }
                }
                buffer.release()
            } catch (e: Exception) {
                Log.e("WearMainActivity", "Failed to query wearable data: ${e.message}")
            }
        }
    }

    private fun saveToPrefsAndUpdateTile(
        taskName: String,
        remainingSeconds: Int,
        totalSeconds: Int,
        isPaused: Boolean,
        isAlarming: Boolean,
        items: List<String>
    ) {
        val prefs = getSharedPreferences("wear_prefs", MODE_PRIVATE)
        prefs.edit().apply {
            putString("taskName", taskName)
            putInt("remainingSeconds", remainingSeconds)
            putInt("totalSeconds", totalSeconds)
            putBoolean("isPaused", isPaused)
            putBoolean("isAlarming", isAlarming)
            putString("items_json", JSONArray(items).toString())
            apply()
        }
        try {
            androidx.wear.tiles.TileService.getUpdater(applicationContext)
                .requestUpdate(WearTimerTileService::class.java)
        } catch (e: Exception) {
            Log.e("WearMainActivity", "Failed to update tile: ${e.message}")
        }
    }

    private fun sendControlMessage(path: String) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val nodes = Wearable.getNodeClient(this@WearMainActivity).connectedNodes.await()
                for (node in nodes) {
                    Wearable.getMessageClient(this@WearMainActivity)
                        .sendMessage(node.id, path, ByteArray(0)).await()
                    Log.d("WearMainActivity", "Control message sent: $path to node ${node.displayName}")
                }
            } catch (e: Exception) {
                Log.e("WearMainActivity", "Failed to send control message $path: ${e.message}")
            }
        }
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        val path = messageEvent.path
        Log.d("WearMainActivity", "Message received from phone: $path")
        if (path.startsWith("/quicklog_success/")) {
            val foodId = path.substring("/quicklog_success/".length)
            val foodLabel = getFoodLabel(foodId)
            triggerVibration()
            runOnUiThread {
                Toast.makeText(this, "$foodLabel logged successfully!", Toast.LENGTH_SHORT).show()
            }
        } else if (path.startsWith("/quicklog_fail/")) {
            val foodId = path.substring("/quicklog_fail/".length)
            val foodLabel = getFoodLabel(foodId)
            runOnUiThread {
                Toast.makeText(this, "Failed to log $foodLabel", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun getFoodLabel(foodId: String): String {
        return when (foodId) {
            "water" -> "🥤 Water"
            "espresso" -> "☕ Espresso"
            "protein_waffles" -> "🧇 Waffle"
            "protein_shake" -> "🥤 Shake"
            "mixed_nuts" -> "🥜 Nuts"
            else -> foodId
        }
    }

    private fun triggerVibration() {
        try {
            val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                vibrator.vibrate(android.os.VibrationEffect.createOneShot(80, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                vibrator.vibrate(80)
            }
        } catch (e: Exception) {
            Log.e("WearMainActivity", "Vibration error: ${e.message}")
        }
    }
}

@Composable
fun WearTimerScreen(
    taskName: String,
    remainingSeconds: Int,
    isPaused: Boolean,
    isAlarming: Boolean,
    timerItems: List<String>,
    scheduleBlocks: List<WatchScheduleBlock>,
    onPauseResumeClick: () -> Unit,
    onCancelClick: () -> Unit,
    onStartBlockClick: (WatchScheduleBlock) -> Unit,
    onRequestSyncClick: () -> Unit,
    onQuickLogClick: (String) -> Unit
) {
    val mins = remainingSeconds / 60
    val secs = remainingSeconds % 60
    val timeStr = String.format("%02d:%02d", mins, secs)

    val active = taskName.isNotEmpty() && taskName != "No task selected" && taskName != "No Active Task"

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
        contentAlignment = Alignment.Center
    ) {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Active Timer View
            item {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier.padding(bottom = 6.dp, top = 16.dp)
                ) {
                    Text(
                        text = if (active) {
                            if (isAlarming) "Time's Up!" else taskName
                        } else "No Active Task",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isAlarming) Color.Red else Color.LightGray,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)
                    )

                    Spacer(modifier = Modifier.height(4.dp))

                    Text(
                        text = if (active) timeStr else "--:--",
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isPaused) Color.Gray else Color(0xFFA882DD),
                        textAlign = TextAlign.Center
                    )

                    Spacer(modifier = Modifier.height(6.dp))

                    if (active) {
                        Row(
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Button(
                                onClick = onPauseResumeClick,
                                colors = ButtonDefaults.buttonColors(
                                    backgroundColor = if (isPaused) Color(0xFF10B981) else Color(0xFF27272A)
                                ),
                                modifier = Modifier.size(32.dp)
                            ) {
                                if (isPaused) {
                                    Icon(
                                        imageVector = Icons.Default.PlayArrow,
                                        contentDescription = "Resume",
                                        tint = Color.White,
                                        modifier = Modifier.size(14.dp)
                                    )
                                } else {
                                    Row(
                                        modifier = Modifier.size(10.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Box(modifier = Modifier.width(2.5.dp).fillMaxHeight().background(Color.White))
                                        Box(modifier = Modifier.width(2.5.dp).fillMaxHeight().background(Color.White))
                                    }
                                }
                            }

                            Spacer(modifier = Modifier.width(10.dp))

                            Button(
                                onClick = onCancelClick,
                                colors = ButtonDefaults.buttonColors(backgroundColor = Color(0xFFEF4444)),
                                modifier = Modifier.size(32.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "Cancel",
                                    tint = Color.White,
                                    modifier = Modifier.size(14.dp)
                                )
                            }
                        }

                        if (timerItems.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "CHECKLIST",
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFFA882DD),
                                textAlign = TextAlign.Center
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            timerItems.forEach { subItem ->
                                Text(
                                    text = "• $subItem",
                                    fontSize = 9.sp,
                                    color = Color.LightGray,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 1.dp)
                                )
                            }
                        }
                    } else {
                        val nextPending = scheduleBlocks.firstOrNull { !it.isCompleted }
                        if (nextPending != null) {
                            Button(
                                onClick = { onStartBlockClick(nextPending) },
                                colors = ButtonDefaults.buttonColors(backgroundColor = Color(0xFF10B981)),
                                modifier = Modifier.fillMaxWidth(0.9f).height(32.dp)
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        imageVector = Icons.Default.PlayArrow,
                                        contentDescription = "Start Next Task",
                                        tint = Color.White,
                                        modifier = Modifier.size(14.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = "Start: ${nextPending.title}",
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        color = Color.White
                                    )
                                }
                            }
                        } else {
                            Text(
                                text = "Tap a block below to start",
                                fontSize = 9.sp,
                                color = Color.DarkGray,
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                }
            }

            // Schedule Time Blocks Header & Items
            item {
                Text(
                    text = "SCHEDULE BLOCKS",
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFFA882DD),
                    modifier = Modifier.padding(top = 10.dp, bottom = 4.dp)
                )
            }

            if (scheduleBlocks.isNotEmpty()) {
                items(scheduleBlocks) { block ->
                    Chip(
                        onClick = { onStartBlockClick(block) },
                        label = {
                            Column {
                                Text(
                                    text = block.title,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    color = if (block.isCompleted) Color.Gray else Color.White
                                )
                                if (block.time.isNotEmpty()) {
                                    Text(
                                        text = block.time,
                                        fontSize = 9.sp,
                                        color = if (block.isCompleted) Color.DarkGray else Color(0xFFA882DD)
                                    )
                                }
                            }
                        },
                        icon = {
                            if (block.isCompleted) {
                                Text("✓", fontSize = 12.sp, color = Color(0xFF10B981), modifier = Modifier.padding(start = 4.dp))
                            } else {
                                Icon(
                                    imageVector = Icons.Default.PlayArrow,
                                    contentDescription = "Start",
                                    tint = Color(0xFFA882DD),
                                    modifier = Modifier.size(14.dp)
                                )
                            }
                        },
                        colors = ChipDefaults.chipColors(
                            backgroundColor = if (block.isCompleted) Color(0xFF161618) else Color(0xFF1E1E24),
                            contentColor = Color.White
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                }
            } else {
                item {
                    Chip(
                        onClick = onRequestSyncClick,
                        label = {
                            Text(
                                text = "🔄 Sync Blocks from Phone",
                                fontSize = 10.sp,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.fillMaxWidth()
                            )
                        },
                        colors = ChipDefaults.chipColors(
                            backgroundColor = Color(0xFF1E1E24),
                            contentColor = Color.White
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                }
            }

            // Quick Log Header
            item {
                Text(
                    text = "QUICK LOG",
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFFA882DD),
                    modifier = Modifier.padding(top = 12.dp, bottom = 4.dp)
                )
            }

            // Quick Log Buttons
            val quickLogFoods = listOf(
                Pair("water", "🥤 Water"),
                Pair("espresso", "☕ Espresso"),
                Pair("protein_waffles", "🧇 Waffle"),
                Pair("protein_shake", "🥤 Shake"),
                Pair("mixed_nuts", "🥜 Nuts")
            )

            items(quickLogFoods) { (foodId, label) ->
                Chip(
                    onClick = { onQuickLogClick(foodId) },
                    label = { Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold) },
                    colors = ChipDefaults.primaryChipColors(
                        backgroundColor = Color(0xFF1C1C1E),
                        contentColor = Color.White
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 10.dp, vertical = 2.dp)
                )
            }

            // Padding item to ensure circular scrolling doesn't cut off the last chip
            item {
                Spacer(modifier = Modifier.height(20.dp))
            }
        }
    }
}

@Composable
fun WearAppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = Colors(
            primary = Color(0xFFA882DD),
            primaryVariant = Color(0xFF8B5CF6),
            secondary = Color(0xFF10B981),
            background = Color.Black,
            onBackground = Color.White
        ),
        content = content
    )
}
