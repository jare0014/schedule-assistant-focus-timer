package com.example

import android.os.Bundle
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.os.Build
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.JavascriptInterface
import org.json.JSONObject
import org.json.JSONArray
import androidx.compose.ui.viewinterop.AndroidView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.data.ObsidianSyncRepository
import com.example.data.SyncPreferences
import com.example.data.Task
import com.example.ui.theme.MyApplicationTheme
import com.example.ui.theme.ObsidianAccentGreen
import com.example.ui.theme.ObsidianBg
import com.example.ui.theme.ObsidianBorder
import com.example.ui.theme.ObsidianPurple
import com.example.ui.theme.ObsidianSurface
import com.example.ui.theme.ObsidianTextDark
import com.example.ui.theme.ObsidianTextMuted
import com.example.ui.theme.ObsidianTextPrimary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.unit.IntSize

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
            }
        }

        com.example.widget.TimerService.checkAndSyncTimerService(this)

        setContent {
            MyApplicationTheme {
                Scaffold(
                    modifier = Modifier
                        .fillMaxSize()
                        .testTag("main_scaffold"),
                    containerColor = ObsidianBg
                ) { innerPadding ->
                    ObsidianTodoScreen(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = innerPadding
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ObsidianTodoScreen(
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues()
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    
    val repository = remember { ObsidianSyncRepository(context) }
    val prefs = remember { SyncPreferences(context) }
    
    // Live database flows
    val tasks by repository.getAllTasksFlow().collectAsStateWithLifecycle(initialValue = emptyList())
    
    val dragDropState = remember { DragDropState() }
    var focusBlocksRect by remember { mutableStateOf<Rect?>(null) }
    var floatingTasksRect by remember { mutableStateOf<Rect?>(null) }
    
    // Configuration states initialized from Preferences
    var serverIp by remember { mutableStateOf(prefs.serverIp) }
    var serverPort by remember { mutableStateOf(prefs.serverPort) }
    var syncMode by remember { mutableStateOf(prefs.syncMode) }
    var pathOrEndpoint by remember { mutableStateOf(prefs.pathOrEndpoint) }
    var apiToken by remember { mutableStateOf(prefs.apiToken) }
    
    // UI reactive states
    var isSyncing by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var selectedViewMode by remember { mutableStateOf("LIST") } // LIST vs GRID
    var lastSyncDateHeader by remember { mutableStateOf(prefs.lastSyncDateHeader) }
    var lastSyncTime by remember { mutableStateOf(prefs.lastSyncTime) }
    var logsList by remember { mutableStateOf(prefs.getLogs()) }
    
    // Active Timer and Alarm states
    var activeTimerTaskName by remember { mutableStateOf(prefs.activeTimerTaskName) }
    var activeTimerRemainingSeconds by remember { mutableStateOf(prefs.activeTimerRemainingSeconds) }
    var activeTimerTotalSeconds by remember { mutableStateOf(prefs.activeTimerTotalSeconds) }
    var activeTimerIsPaused by remember { mutableStateOf(prefs.activeTimerIsPaused) }
    var activeTimerLineIndex by remember { mutableStateOf(prefs.activeTimerLineIndex) }
    var isAlarming by remember { mutableStateOf(prefs.isAlarming) }
    
    // Sub-category expand / collapse mapping (defaults to expanding all of them)
    val expandedSubCategories = remember { mutableStateMapOf<String, Boolean>() }
    val expandedProjects = remember { mutableStateMapOf<String, Boolean>() }
    val showAllTasksPerProject = remember { mutableStateMapOf<String, Boolean>() }
    
    // Background ticking clock for local convenience
    var currentTimeString by remember { mutableStateOf("") }
    // Dynamic state listener to sync visual preferences immediately
    val refreshPreferencesState = {
        lastSyncDateHeader = prefs.lastSyncDateHeader
        lastSyncTime = prefs.lastSyncTime
        logsList = prefs.getLogs()
        activeTimerTaskName = prefs.activeTimerTaskName
        activeTimerRemainingSeconds = prefs.activeTimerRemainingSeconds
        activeTimerTotalSeconds = prefs.activeTimerTotalSeconds
        activeTimerIsPaused = prefs.activeTimerIsPaused
        activeTimerLineIndex = prefs.activeTimerLineIndex
        isAlarming = prefs.isAlarming
    }
    val makeDragModifier = @Composable { task: Task ->
        var itemPositionInRoot by remember(task) { mutableStateOf(Offset.Zero) }
        Modifier
            .onGloballyPositioned { coordinates ->
                itemPositionInRoot = coordinates.positionInRoot()
            }
            .pointerInput(task) {
                detectDragGesturesAfterLongPress(
                    onDragStart = { offset ->
                        dragDropState.draggedTask = task
                        dragDropState.dragPosition = itemPositionInRoot + offset
                        dragDropState.isDragging = true
                    },
                    onDrag = { change, dragAmount ->
                        change.consume()
                        dragDropState.dragPosition += dragAmount
                    },
                    onDragEnd = {
                        val finalPos = dragDropState.dragPosition
                        if (task.category == "FOCUS BLOCKS") {
                            if (floatingTasksRect?.contains(finalPos) == true) {
                                scope.launch(Dispatchers.IO) {
                                    repository.dropTask(task, "### ☁️ Floating Micro-Tasks (Untimed)")
                                    scope.launch(Dispatchers.Main) {
                                        refreshPreferencesState()
                                    }
                                }
                            }
                        } else {
                            if (focusBlocksRect?.contains(finalPos) == true) {
                                scope.launch(Dispatchers.IO) {
                                    repository.dropTask(task, "### ⏱️ Focus Blocks")
                                    scope.launch(Dispatchers.Main) {
                                        refreshPreferencesState()
                                    }
                                }
                            }
                        }
                        dragDropState.draggedTask = null
                        dragDropState.isDragging = false
                    },
                    onDragCancel = {
                        dragDropState.draggedTask = null
                        dragDropState.isDragging = false
                    }
                )
            }
    }
    


    LaunchedEffect(Unit) {
        var pollCounter = 0
        while (true) {
            currentTimeString = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
            
            // Real-time wall-clock countdown calculation
            if (prefs.activeTimerTaskName.isNotEmpty()) {
                if (prefs.activeTimerIsPaused) {
                    activeTimerRemainingSeconds = prefs.activeTimerRemainingSeconds
                } else {
                    val targetEnd = prefs.activeTimerTargetEndTime
                    if (targetEnd > 0L) {
                        val remainingMs = (targetEnd - System.currentTimeMillis()).coerceAtLeast(0L)
                        activeTimerRemainingSeconds = kotlin.math.ceil(remainingMs / 1000.0).toInt()
                        prefs.activeTimerRemainingSeconds = activeTimerRemainingSeconds
                    } else if (activeTimerRemainingSeconds > 0) {
                        activeTimerRemainingSeconds--
                        prefs.activeTimerRemainingSeconds = activeTimerRemainingSeconds
                    }
                }
            } else {
                activeTimerRemainingSeconds = 0
            }
            
            pollCounter++
            if (pollCounter >= 2) { // Poll status every 2 seconds
                pollCounter = 0
                scope.launch(Dispatchers.IO) {
                    repository.syncActiveTimer()
                    scope.launch(Dispatchers.Main) {
                        refreshPreferencesState()
                    }
                }
            }
            kotlinx.coroutines.delay(1000)
        }
    }


    // Alarm Alert Dialog Overlay
    if (isAlarming) {
        AlertDialog(
            onDismissRequest = {},
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Info, contentDescription = null, tint = ObsidianPurple)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Focus Block Finished!", color = ObsidianTextPrimary, fontWeight = FontWeight.Bold)
                }
            },
            text = {
                Column {
                    Text("What would you like to do with:", color = ObsidianTextMuted, fontSize = 12.sp)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(activeTimerTaskName, color = ObsidianTextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
            },
            containerColor = ObsidianSurface,
            confirmButton = {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Postpone
                    TextButton(
                        onClick = {
                            scope.launch(Dispatchers.IO) {
                                val line = activeTimerLineIndex
                                if (line > 0) {
                                    val dummyTask = Task(id = "", text = activeTimerTaskName, isCompleted = false, lineNumber = line)
                                    repository.postponeTask(dummyTask)
                                }
                                repository.cancelTimer() // dismiss alarm
                                repository.syncTasks()
                                scope.launch(Dispatchers.Main) {
                                    refreshPreferencesState()
                                }
                            }
                        }
                    ) {
                        Text("Postpone", color = ObsidianPurple)
                    }
                    
                    // Complete
                    Button(
                        onClick = {
                            scope.launch(Dispatchers.IO) {
                                repository.completeTimer()
                                scope.launch(Dispatchers.Main) {
                                    refreshPreferencesState()
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = ObsidianPurple)
                    ) {
                        Text("Complete", color = ObsidianBg, fontWeight = FontWeight.Bold)
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        scope.launch(Dispatchers.IO) {
                            repository.cancelTimer() // dismiss alarm
                            scope.launch(Dispatchers.Main) {
                                refreshPreferencesState()
                            }
                        }
                    }
                ) {
                    Text("Dismiss", color = ObsidianTextMuted)
                }
            }
        )
    }

    Box(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(ObsidianBg)
                .padding(contentPadding)
                .padding(16.dp)
        ) {
        // App header containing: Date Indicator, Manual Sync, Settings Switcher
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(
                    text = lastSyncDateHeader,
                    color = ObsidianTextPrimary,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.SansSerif,
                    modifier = Modifier.testTag("app_date_title")
                )
                Text(
                    text = if (lastSyncTime > 0) {
                        val formattedTime = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(lastSyncTime))
                        "Last sync: $formattedTime"
                    } else "Never Synced",
                    color = ObsidianTextMuted,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // Settings Toggle
                IconButton(
                    onClick = { showSettings = !showSettings },
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (showSettings) ObsidianPurple.copy(alpha = 0.2f) else ObsidianSurface)
                        .border(1.dp, ObsidianBorder, RoundedCornerShape(8.dp))
                        .size(40.dp)
                        .testTag("settings_button")
                ) {
                    Icon(
                        imageVector = Icons.Default.Settings,
                        contentDescription = "Sync Config Settings",
                        tint = if (showSettings) ObsidianPurple else ObsidianTextPrimary
                    )
                }

                // Sync Trigger Button
                Button(
                    onClick = {
                        isSyncing = true
                        prefs.addLog("Triggered manual sync...")
                        scope.launch(Dispatchers.IO) {
                            val success = repository.syncTasks()
                            scope.launch(Dispatchers.Main) {
                                isSyncing = false
                                refreshPreferencesState()
                                if (success) {
                                    Toast.makeText(context, "Obsidian Sync Complete!", Toast.LENGTH_SHORT).show()
                                } else {
                                    Toast.makeText(context, "Sync Failed. Check IP and Port in Config.", Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = ObsidianSurface,
                        contentColor = ObsidianPurple
                    ),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, ObsidianBorder),
                    contentPadding = PaddingValues(horizontal = 12.dp),
                    modifier = Modifier
                        .height(40.dp)
                        .testTag("sync_trigger_button")
                ) {
                    if (isSyncing) {
                        CircularProgressIndicator(
                            color = ObsidianPurple,
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Sync",
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "Sync",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                // Generate Schedule Button
                var isGenerating by remember { mutableStateOf(false) }
                Button(
                    onClick = {
                        isGenerating = true
                        prefs.addLog("Requesting schedule generation...")
                        scope.launch(Dispatchers.IO) {
                            val success = repository.generateSchedule()
                            if (success) {
                                // Pause briefly for the background generation to complete, then auto sync
                                kotlinx.coroutines.delay(2000)
                                repository.syncTasks()
                            }
                            scope.launch(Dispatchers.Main) {
                                isGenerating = false
                                refreshPreferencesState()
                                if (success) {
                                    Toast.makeText(context, "Schedule Generated!", Toast.LENGTH_SHORT).show()
                                } else {
                                    Toast.makeText(context, "Generation Failed. Check PC Server.", Toast.LENGTH_LONG).show()
                                }
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = ObsidianSurface,
                        contentColor = ObsidianAccentGreen
                    ),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, ObsidianBorder),
                    contentPadding = PaddingValues(horizontal = 12.dp),
                    modifier = Modifier
                        .height(40.dp)
                        .testTag("generate_trigger_button")
                ) {
                    if (isGenerating) {
                        CircularProgressIndicator(
                            color = ObsidianAccentGreen,
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Default.PlayArrow,
                            contentDescription = "Generate",
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "Generate",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

            }
        }

        // Segmented View Mode Switcher Row (List View vs Timeline Grid)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 12.dp)
                .background(ObsidianSurface, RoundedCornerShape(8.dp))
                .border(1.dp, ObsidianBorder, RoundedCornerShape(8.dp))
                .padding(4.dp)
        ) {
            // List View Tab
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(36.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (selectedViewMode == "LIST") ObsidianPurple.copy(alpha = 0.25f) else Color.Transparent)
                    .border(
                        1.dp,
                        if (selectedViewMode == "LIST") ObsidianPurple else Color.Transparent,
                        RoundedCornerShape(6.dp)
                    )
                    .clickable { selectedViewMode = "LIST" },
                contentAlignment = Alignment.Center
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.List,
                        contentDescription = null,
                        tint = if (selectedViewMode == "LIST") ObsidianPurple else ObsidianTextMuted,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "List View",
                        color = if (selectedViewMode == "LIST") ObsidianTextPrimary else ObsidianTextMuted,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            // Timeline Grid Tab
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(36.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (selectedViewMode == "GRID") ObsidianPurple.copy(alpha = 0.25f) else Color.Transparent)
                    .border(
                        1.dp,
                        if (selectedViewMode == "GRID") ObsidianPurple else Color.Transparent,
                        RoundedCornerShape(6.dp)
                    )
                    .clickable { selectedViewMode = "GRID" },
                contentAlignment = Alignment.Center
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.DateRange,
                        contentDescription = null,
                        tint = if (selectedViewMode == "GRID") ObsidianPurple else ObsidianTextMuted,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Timeline Grid",
                        color = if (selectedViewMode == "GRID") ObsidianTextPrimary else ObsidianTextMuted,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }

        // Animated Expanding Config Form Accordion
        AnimatedVisibility(visible = showSettings) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 16.dp)
                    .border(1.dp, ObsidianBorder, RoundedCornerShape(12.dp))
                    .testTag("settings_panel"),
                colors = CardDefaults.cardColors(containerColor = ObsidianSurface),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Text(
                        text = "Obsidian Server Configuration",
                        color = ObsidianPurple,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(bottom = 12.dp)
                    )

                    // IP Field
                    OutlinedTextField(
                        value = serverIp,
                        onValueChange = {
                            serverIp = it
                            prefs.serverIp = it
                        },
                        label = { Text("Server PC IP (e.g. 10.0.0.75)", color = ObsidianTextMuted) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 8.dp)
                            .testTag("input_server_ip"),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = ObsidianTextPrimary,
                            unfocusedTextColor = ObsidianTextPrimary,
                            focusedBorderColor = ObsidianPurple,
                            unfocusedBorderColor = ObsidianBorder
                        ),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text)
                    )

                    // Port Field
                    OutlinedTextField(
                        value = serverPort,
                        onValueChange = {
                            serverPort = it
                            prefs.serverPort = it
                        },
                        label = { Text("Server Port (default 8090)", color = ObsidianTextMuted) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 8.dp)
                            .testTag("input_server_port"),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = ObsidianTextPrimary,
                            unfocusedTextColor = ObsidianTextPrimary,
                            focusedBorderColor = ObsidianPurple,
                            unfocusedBorderColor = ObsidianBorder
                        ),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                    )

                    // File Path / Endpoint
                    OutlinedTextField(
                        value = pathOrEndpoint,
                        onValueChange = {
                            pathOrEndpoint = it
                            prefs.pathOrEndpoint = it
                        },
                        label = { Text("Markdown File Path (or REST API path)", color = ObsidianTextMuted) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 8.dp)
                            .testTag("input_note_path"),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = ObsidianTextPrimary,
                            unfocusedTextColor = ObsidianTextPrimary,
                            focusedBorderColor = ObsidianPurple,
                            unfocusedBorderColor = ObsidianBorder
                        ),
                        singleLine = true
                    )

                    // API Token (Optional)
                    OutlinedTextField(
                        value = apiToken,
                        onValueChange = {
                            apiToken = it
                            prefs.apiToken = it
                        },
                        label = { Text("Authorization API Token (Optional)", color = ObsidianTextMuted) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 8.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = ObsidianTextPrimary,
                            unfocusedTextColor = ObsidianTextPrimary,
                            focusedBorderColor = ObsidianPurple,
                            unfocusedBorderColor = ObsidianBorder
                        ),
                        singleLine = true
                    )

                    // Format mode selector: Markdown vs JSON
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Format Mode: ", color = ObsidianTextPrimary, fontSize = 12.sp)
                        Spacer(modifier = Modifier.width(8.dp))
                        Row(
                            modifier = Modifier
                                .clickable {
                                    syncMode = "MARKDOWN"
                                    prefs.syncMode = "MARKDOWN"
                                }
                                .padding(4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = (syncMode == "MARKDOWN"),
                                onClick = {
                                    syncMode = "MARKDOWN"
                                    prefs.syncMode = "MARKDOWN"
                                },
                                colors = RadioButtonDefaults.colors(selectedColor = ObsidianPurple)
                            )
                            Text("Markdown", color = ObsidianTextPrimary, fontSize = 12.sp)
                        }
                        Spacer(modifier = Modifier.width(16.dp))
                        Row(
                            modifier = Modifier
                                .clickable {
                                    syncMode = "JSON"
                                    prefs.syncMode = "JSON"
                                }
                                .padding(4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = (syncMode == "JSON"),
                                onClick = {
                                    syncMode = "JSON"
                                    prefs.syncMode = "JSON"
                                },
                                colors = RadioButtonDefaults.colors(selectedColor = ObsidianPurple)
                            )
                            Text("JSON API", color = ObsidianTextPrimary, fontSize = 12.sp)
                        }
                    }

                    // Connection troubleshooting hint
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Hint: Ensure your computer is running Obsidian-Local-REST-API or a simple Markdown host (on HTTP port 8090) and that both your PC and phone are on the same local Wi-Fi network. You can use dynamic date placeholders like {YYYY-MM-DD} or {date} in the file path to automatically target the current day's daily journal note.",
                        color = ObsidianAccentGreen,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.SansSerif,
                        lineHeight = 15.sp
                    )
                }
            }
        }

        // Active Timer Card UI
        AnimatedVisibility(visible = activeTimerTaskName.isNotEmpty()) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 16.dp)
                    .border(1.dp, ObsidianBorder, RoundedCornerShape(16.dp)),
                colors = CardDefaults.cardColors(containerColor = ObsidianSurface),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            brush = Brush.linearGradient(
                                colors = listOf(
                                    ObsidianSurface,
                                    ObsidianPurple.copy(alpha = 0.15f)
                                )
                            )
                        )
                        .padding(16.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.Info,
                                contentDescription = "Active Timer Icon",
                                tint = ObsidianPurple,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "ACTIVE FOCUS SESSION",
                                color = ObsidianPurple,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.ExtraBold,
                                letterSpacing = 1.sp
                            )
                        }
                        
                        // Remaining formatted time
                        Text(
                            text = String.format(
                                "%02d:%02d",
                                activeTimerRemainingSeconds / 60,
                                activeTimerRemainingSeconds % 60
                            ),
                            color = ObsidianTextPrimary,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                    
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    // Task Description
                    Text(
                        text = activeTimerTaskName,
                        color = ObsidianTextPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                    
                    Spacer(modifier = Modifier.height(12.dp))
                    
                    // Progress bar
                    val elapsedFraction = if (activeTimerTotalSeconds > 0) {
                        ((activeTimerTotalSeconds - activeTimerRemainingSeconds).toFloat() / activeTimerTotalSeconds).coerceIn(0f, 1f)
                    } else 0f
                    
                    LinearProgressIndicator(
                        progress = { elapsedFraction },
                        color = ObsidianPurple,
                        trackColor = ObsidianBorder,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(3.dp))
                    )
                    
                    Spacer(modifier = Modifier.height(16.dp))
                    
                    // Controls Row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Cancel Session
                        Button(
                            onClick = {
                                scope.launch(Dispatchers.IO) {
                                    repository.cancelTimer()
                                    scope.launch(Dispatchers.Main) {
                                        refreshPreferencesState()
                                    }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Color(0xFF3F3F46),
                                contentColor = ObsidianTextPrimary
                            ),
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            modifier = Modifier.height(36.dp)
                        ) {
                            Text("Cancel", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                        
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            // Pause / Resume
                            Button(
                                onClick = {
                                    scope.launch(Dispatchers.IO) {
                                        if (activeTimerIsPaused) {
                                            repository.resumeTimer()
                                        } else {
                                            repository.pauseTimer()
                                        }
                                        scope.launch(Dispatchers.Main) {
                                            refreshPreferencesState()
                                        }
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = ObsidianSurface,
                                    contentColor = if (activeTimerIsPaused) ObsidianAccentGreen else ObsidianTextPrimary
                                ),
                                border = BorderStroke(1.dp, ObsidianBorder),
                                shape = RoundedCornerShape(8.dp),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                modifier = Modifier.height(36.dp)
                            ) {
                                Text(
                                    text = if (activeTimerIsPaused) "Resume" else "Pause",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            
                            // Complete
                            Button(
                                onClick = {
                                    scope.launch(Dispatchers.IO) {
                                        repository.completeTimer()
                                        scope.launch(Dispatchers.Main) {
                                            refreshPreferencesState()
                                        }
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = ObsidianPurple,
                                    contentColor = ObsidianBg
                                ),
                                shape = RoundedCornerShape(8.dp),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                modifier = Modifier.height(36.dp)
                            ) {
                                Text("Complete", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }

        // Quick Log Nutrition Panel
        var isLoggingFood by remember { mutableStateOf<String?>(null) }
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 16.dp)
                .border(1.dp, ObsidianBorder, RoundedCornerShape(12.dp)),
            colors = CardDefaults.cardColors(containerColor = ObsidianSurface),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Text(
                    text = "QUICK LOG NUTRITION",
                    color = ObsidianPurple,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 1.sp,
                    modifier = Modifier.padding(bottom = 8.dp)
                )
                
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val foods = listOf(
                        Triple("water", "🥤", "Water"),
                        Triple("espresso", "☕", "Espress"),
                        Triple("protein_waffles", "🧇", "Waffle"),
                        Triple("protein_shake", "🥤", "Shake"),
                        Triple("mixed_nuts", "🥜", "Nuts")
                    )
                    
                    foods.forEach { (foodId, emoji, name) ->
                        val isCurrentLogging = isLoggingFood == foodId
                        Button(
                            onClick = {
                                if (isLoggingFood == null) {
                                    isLoggingFood = foodId
                                    scope.launch(Dispatchers.IO) {
                                        val success = repository.quickLog(foodId)
                                        scope.launch(Dispatchers.Main) {
                                            isLoggingFood = null
                                            if (success) {
                                                Toast.makeText(context, "$emoji $name logged!", Toast.LENGTH_SHORT).show()
                                            } else {
                                                Toast.makeText(context, "Failed to log $name.", Toast.LENGTH_SHORT).show()
                                            }
                                            refreshPreferencesState()
                                        }
                                    }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (isCurrentLogging) ObsidianPurple.copy(alpha = 0.2f) else ObsidianBg,
                                contentColor = ObsidianTextPrimary
                            ),
                            border = BorderStroke(1.dp, ObsidianBorder),
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
                            modifier = Modifier
                                .weight(1f)
                                .height(38.dp)
                        ) {
                            if (isCurrentLogging) {
                                CircularProgressIndicator(
                                    color = ObsidianPurple,
                                    modifier = Modifier.size(12.dp),
                                    strokeWidth = 2.dp
                                )
                            } else {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(text = emoji, fontSize = 11.sp)
                                    Text(
                                        text = name,
                                        fontSize = 8.sp,
                                        fontWeight = FontWeight.Bold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // Divider
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(ObsidianBorder)
                .padding(bottom = 12.dp)
        )

        // Split lists by Focus Blocks and Untimed general tasks (filtering out completed tasks)
        val focusBlocks = remember(tasks) { tasks.filter { it.category == "FOCUS BLOCKS" && !it.isCompleted } }
        val floatingTasks = remember(tasks) { tasks.filter { it.category != "FOCUS BLOCKS" && !it.isCompleted } }

        if (selectedViewMode == "GRID") {
            NativeTimelineGridView(
                tasks = tasks,
                onStartTimer = { task ->
                    scope.launch(Dispatchers.IO) {
                        repository.startTimer(task)
                        scope.launch(Dispatchers.Main) { refreshPreferencesState() }
                    }
                },
                onToggleTask = { task ->
                    scope.launch(Dispatchers.IO) {
                        repository.toggleTask(task, !task.isCompleted)
                        scope.launch(Dispatchers.Main) { refreshPreferencesState() }
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            )
        } else if (focusBlocks.isEmpty() && floatingTasks.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Sync pending",
                        tint = ObsidianBorder,
                        modifier = Modifier.size(52.dp)
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "No checklist items found",
                        color = ObsidianTextPrimary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Connect to http://$serverIp:$serverPort$pathOrEndpoint\nand tap Sync at the top.",
                        color = ObsidianTextMuted,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )
                }
            }
        } else {
            val isDraggingTimed = dragDropState.isDragging && dragDropState.draggedTask?.category == "FOCUS BLOCKS"
            val isDraggingUntimed = dragDropState.isDragging && dragDropState.draggedTask?.category != "FOCUS BLOCKS"

            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .testTag("task_list_view"),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Focus Blocks Header
                if (focusBlocks.isNotEmpty()) {
                    item {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .onGloballyPositioned { coordinates ->
                                    focusBlocksRect = coordinates.boundsInRoot()
                                }
                                .then(
                                    if (isDraggingUntimed) {
                                        Modifier
                                            .border(2.dp, ObsidianPurple.copy(alpha = 0.6f), RoundedCornerShape(12.dp))
                                            .background(ObsidianPurple.copy(alpha = 0.08f), RoundedCornerShape(12.dp))
                                            .padding(8.dp)
                                    } else Modifier
                                ),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = "Focus",
                                    tint = ObsidianPurple,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "FOCUS BLOCKS",
                                    color = ObsidianPurple,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    fontFamily = FontFamily.SansSerif,
                                    letterSpacing = 1.sp
                                )
                            }
                            
                            // Group focus blocks by project and display expandable sections with item limits
                            val projectGroups = focusBlocks.groupBy { 
                                val p = it.project
                                if (p.isNullOrEmpty() || p == "null") "General Tasks" else p
                            }

                            projectGroups.forEach { (project, projectTasks) ->
                                val isExpanded = expandedProjects[project] ?: true
                                val showAll = showAllTasksPerProject[project] ?: false
                                val maxItems = 20

                                Column(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    // Project Header with collapse/expand arrow
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable { expandedProjects[project] = !isExpanded }
                                            .padding(vertical = 4.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                                            val angle by animateFloatAsState(targetValue = if (isExpanded) 180f else 0f)
                                            Icon(
                                                imageVector = Icons.Default.ArrowDropDown,
                                                contentDescription = "Expand Project dropdown",
                                                tint = ObsidianPurple,
                                                modifier = Modifier
                                                    .size(20.dp)
                                                    .rotate(angle)
                                            )
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text(
                                                text = project,
                                                color = ObsidianTextPrimary,
                                                fontSize = 13.sp,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }
                                        
                                        // Count display indicator
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(12.dp))
                                                .background(ObsidianBorder)
                                                .padding(horizontal = 8.dp, vertical = 2.dp)
                                        ) {
                                            Text(
                                                text = "${projectTasks.size}",
                                                color = ObsidianTextMuted,
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }
                                    }

                                    AnimatedVisibility(visible = isExpanded) {
                                        Column(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(start = 12.dp, end = 12.dp, bottom = 4.dp),
                                            verticalArrangement = Arrangement.spacedBy(8.dp)
                                        ) {
                                            val displayedTasks = if (showAll) projectTasks else projectTasks.take(maxItems)
                                            
                                            displayedTasks.forEach { task ->
                                                FocusBlockItemCard(
                                                    task = task,
                                                    isActiveTimer = (activeTimerLineIndex == task.lineNumber),
                                                    modifier = makeDragModifier(task),
                                                    onToggle = { isChecked ->
                                                        scope.launch(Dispatchers.IO) {
                                                            repository.toggleTask(task, isChecked)
                                                            scope.launch(Dispatchers.Main) {
                                                                refreshPreferencesState()
                                                            }
                                                        }
                                                    },
                                                    onPlayClick = {
                                                        scope.launch(Dispatchers.IO) {
                                                            if (activeTimerLineIndex == task.lineNumber) {
                                                                repository.cancelTimer()
                                                            } else {
                                                                repository.startTimer(task)
                                                            }
                                                            scope.launch(Dispatchers.Main) {
                                                                refreshPreferencesState()
                                                            }
                                                        }
                                                    },
                                                    onPostponeClick = {
                                                        scope.launch(Dispatchers.IO) {
                                                            repository.postponeTask(task)
                                                            scope.launch(Dispatchers.Main) {
                                                                refreshPreferencesState()
                                                            }
                                                        }
                                                    },
                                                    onMoveClick = {
                                                        scope.launch(Dispatchers.IO) {
                                                            repository.dropTask(task, "### ☁️ Floating Micro-Tasks (Untimed)")
                                                            scope.launch(Dispatchers.Main) {
                                                                refreshPreferencesState()
                                                            }
                                                        }
                                                    },
                                                    onSkipClick = {
                                                        scope.launch(Dispatchers.IO) {
                                                            repository.skipTask(task)
                                                            scope.launch(Dispatchers.Main) {
                                                                refreshPreferencesState()
                                                            }
                                                        }
                                                    }
                                                )
                                            }

                                            if (projectTasks.size > maxItems) {
                                                Text(
                                                    text = if (showAll) "Show less" else "Show ${projectTasks.size - maxItems} more...",
                                                    color = ObsidianPurple,
                                                    fontSize = 12.sp,
                                                    fontWeight = FontWeight.Bold,
                                                    modifier = Modifier
                                                        .clickable { showAllTasksPerProject[project] = !showAll }
                                                        .padding(vertical = 4.dp)
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Floating Micro-Tasks section
                if (floatingTasks.isNotEmpty()) {
                    item {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .onGloballyPositioned { coordinates ->
                                    floatingTasksRect = coordinates.boundsInRoot()
                                }
                                .then(
                                    if (isDraggingTimed) {
                                        Modifier
                                            .border(2.dp, ObsidianPurple.copy(alpha = 0.6f), RoundedCornerShape(12.dp))
                                            .background(ObsidianPurple.copy(alpha = 0.08f), RoundedCornerShape(12.dp))
                                            .padding(8.dp)
                                    } else Modifier
                                ),
                            verticalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Refresh,
                                    contentDescription = "Floating",
                                    tint = ObsidianPurple,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "FLOATING MICRO-TASKS (UNTIMED)",
                                    color = ObsidianPurple,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    fontFamily = FontFamily.SansSerif,
                                    letterSpacing = 1.sp
                                )
                            }

                            // Group floating tasks by sub-categories (like "Admin", "Work", or "Untimed")
                            val grouped = floatingTasks.groupBy { it.subCategory ?: "General tasks" }

                            grouped.forEach { (subCat, itemsList) ->
                                val isExpanded = expandedSubCategories[subCat] ?: true

                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(ObsidianSurface)
                                        .border(1.dp, ObsidianBorder, RoundedCornerShape(8.dp))
                                ) {
                                    // Accordion collapsible header item
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable { expandedSubCategories[subCat] = !isExpanded }
                                            .padding(12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            val angle by animateFloatAsState(targetValue = if (isExpanded) 180f else 0f)
                                            Icon(
                                                imageVector = Icons.Default.ArrowDropDown,
                                                contentDescription = "Expand Category dropdown",
                                                tint = ObsidianPurple,
                                                modifier = Modifier
                                                    .size(20.dp)
                                                    .rotate(angle)
                                            )
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text(
                                                text = subCat,
                                                color = ObsidianTextPrimary,
                                                fontSize = 13.sp,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }

                                        // Count display indicator
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(12.dp))
                                                .background(ObsidianBorder)
                                                .padding(horizontal = 8.dp, vertical = 2.dp)
                                        ) {
                                            Text(
                                                text = "${itemsList.filter { !it.isCompleted }.size}/${itemsList.size}",
                                                color = ObsidianTextMuted,
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }
                                    }

                                    AnimatedVisibility(visible = isExpanded) {
                                        Column(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(start = 12.dp, end = 12.dp, bottom = 12.dp),
                                            verticalArrangement = Arrangement.spacedBy(8.dp)
                                        ) {
                                            val projectGroups = itemsList.groupBy { 
                                                val p = it.project
                                                if (p.isNullOrEmpty() || p == "null") "General Tasks" else p
                                            }

                                            projectGroups.forEach { (project, projectTasks) ->
                                                Column(
                                                    modifier = Modifier.fillMaxWidth(),
                                                    verticalArrangement = Arrangement.spacedBy(4.dp)
                                                ) {
                                                    Text(
                                                        text = project.uppercase(),
                                                        fontSize = 9.sp,
                                                        fontWeight = FontWeight.ExtraBold,
                                                        color = ObsidianPurple,
                                                        letterSpacing = 0.5.sp,
                                                        modifier = Modifier.padding(top = 8.dp, bottom = 2.dp)
                                                    )

                                                    projectTasks.forEach { task ->
                                                        FloatingTaskItemRow(
                                                            task = task,
                                                            modifier = makeDragModifier(task),
                                                            onToggle = { isChecked ->
                                                                scope.launch(Dispatchers.IO) {
                                                                    repository.toggleTask(task, isChecked)
                                                                    scope.launch(Dispatchers.Main) {
                                                                        refreshPreferencesState()
                                                                    }
                                                                }
                                                            },
                                                            onPlayClick = {
                                                                scope.launch(Dispatchers.IO) {
                                                                    repository.startTimer(task, 15)
                                                                    scope.launch(Dispatchers.Main) {
                                                                        refreshPreferencesState()
                                                                    }
                                                                }
                                                            },
                                                            onMoveClick = {
                                                                scope.launch(Dispatchers.IO) {
                                                                    repository.dropTask(task, "### ⏱️ Focus Blocks")
                                                                    scope.launch(Dispatchers.Main) {
                                                                        refreshPreferencesState()
                                                                    }
                                                                }
                                                            },
                                                            onSkipClick = {
                                                                scope.launch(Dispatchers.IO) {
                                                                    repository.skipTask(task)
                                                                    scope.launch(Dispatchers.Main) {
                                                                        refreshPreferencesState()
                                                                    }
                                                                }
                                                            }
                                                        )
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Live Debug Logs Window (Accordion)
        var showLogs by remember { mutableStateOf(false) }
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp)
                .border(1.dp, ObsidianBorder, RoundedCornerShape(8.dp)),
            colors = CardDefaults.cardColors(containerColor = ObsidianSurface),
            shape = RoundedCornerShape(8.dp)
        ) {
            Column {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { showLogs = !showLogs }
                        .padding(10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = "Logs Info Icon",
                            tint = ObsidianTextMuted,
                            modifier = Modifier.size(14.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Connection Log & Troubleshooter",
                            color = ObsidianTextPrimary,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Icon(
                        imageVector = if (showLogs) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                        contentDescription = "Toggle logs",
                        tint = ObsidianTextMuted,
                        modifier = Modifier.size(16.dp)
                    )
                }

                AnimatedVisibility(visible = showLogs) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(140.dp)
                            .padding(10.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Realtime Sync Stack (Newest first):", color = ObsidianPurple, fontSize = 10.sp)
                            Text(
                                "Clear", 
                                color = ObsidianTextMuted, 
                                fontSize = 10.sp,
                                modifier = Modifier
                                    .clickable {
                                        prefs.clearLogs()
                                        refreshPreferencesState()
                                    }
                                    .padding(horizontal = 4.dp)
                            )
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1.0f)
                                .background(Color.Black.copy(alpha = 0.3f))
                                .padding(6.dp),
                            verticalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            items(logsList) { log ->
                                Text(
                                    text = log,
                                    color = if (log.contains("Error") || log.contains("failed") || log.contains("Failed")) Color(0xFFEF4444) else if (log.contains("Parsed") || log.contains("Success")) ObsidianAccentGreen else ObsidianTextPrimary,
                                    fontSize = 10.sp,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                        }
                    }
                }
            }
        }

        // Drag ghost overlay
        if (dragDropState.isDragging && dragDropState.draggedTask != null) {
            val draggingTask = dragDropState.draggedTask!!
            Box(
                modifier = Modifier
                    .offset {
                        val xOffset = 150.dp.roundToPx()
                        val yOffset = 40.dp.roundToPx()
                        IntOffset(
                            (dragDropState.dragPosition.x.toInt() - xOffset),
                            (dragDropState.dragPosition.y.toInt() - yOffset)
                        )
                    }
                    .shadow(12.dp, RoundedCornerShape(12.dp))
                    .alpha(0.85f)
                    .width(300.dp)
                    .background(ObsidianSurface, RoundedCornerShape(12.dp))
                    .border(1.dp, ObsidianBorder, RoundedCornerShape(12.dp))
                    .padding(14.dp)
            ) {
                Column {
                    Text(
                        text = draggingTask.displayTitle,
                        color = ObsidianTextPrimary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    if (draggingTask.timeRange != null) {
                        Text(
                            text = draggingTask.timeRange,
                            color = ObsidianPurple,
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                }
            }
        }
    }
}
}

@Composable
fun FocusBlockItemCard(
    task: Task,
    isActiveTimer: Boolean,
    modifier: Modifier = Modifier,
    onToggle: (Boolean) -> Unit,
    onPlayClick: () -> Unit,
    onPostponeClick: () -> Unit,
    onMoveClick: () -> Unit,
    onSkipClick: () -> Unit
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .border(1.dp, ObsidianBorder, RoundedCornerShape(12.dp)),
        colors = CardDefaults.cardColors(containerColor = ObsidianSurface),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(
                modifier = Modifier.weight(1f)
            ) {
                // Time Range
                Text(
                    text = task.timeRange ?: "18:00 - 18:30",
                    color = ObsidianPurple,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )
                Spacer(modifier = Modifier.height(4.dp))
                // Title
                Text(
                    text = task.displayTitle,
                    color = if (task.isCompleted) ObsidianTextMuted else ObsidianTextPrimary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    textDecoration = if (task.isCompleted) TextDecoration.LineThrough else TextDecoration.None
                )
            }

            // Right Actions Block (matches Obsidian web dashboard layout exactly)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Checkbox
                Checkbox(
                    checked = task.isCompleted,
                    onCheckedChange = { onToggle(it) },
                    colors = CheckboxDefaults.colors(
                        checkedColor = ObsidianPurple,
                        uncheckedColor = ObsidianTextMuted,
                        checkmarkColor = ObsidianBg
                    ),
                    modifier = Modifier.size(24.dp)
                )

                // Circle 1: Play/Cancel Timer
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(ObsidianBg)
                        .border(1.dp, ObsidianBorder, CircleShape)
                        .clickable { onPlayClick() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = if (isActiveTimer) Icons.Default.Close else Icons.Default.PlayArrow,
                        contentDescription = if (isActiveTimer) "Cancel Timer Button" else "Start Timer Button",
                        tint = if (isActiveTimer) ObsidianPurple else ObsidianTextDark,
                        modifier = Modifier.size(12.dp)
                    )
                }

                // Circle 2: Postpone
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(ObsidianBg)
                        .border(1.dp, ObsidianBorder, CircleShape)
                        .clickable { onPostponeClick() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Postpone Task Button",
                        tint = ObsidianTextDark,
                        modifier = Modifier.size(12.dp)
                    )
                }

                // Circle 3: Move to Floating
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(ObsidianBg)
                        .border(1.dp, ObsidianBorder, CircleShape)
                        .clickable { onMoveClick() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.KeyboardArrowDown,
                        contentDescription = "Move to Floating Tasks",
                        tint = ObsidianTextDark,
                        modifier = Modifier.size(12.dp)
                    )
                }

                // Circle 4: Not Today (Skip)
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(ObsidianBg)
                        .border(1.dp, ObsidianBorder, CircleShape)
                        .clickable { onSkipClick() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Delete,
                        contentDescription = "Skip Task Button",
                        tint = ObsidianTextDark,
                        modifier = Modifier.size(12.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun FloatingTaskItemRow(
    task: Task,
    modifier: Modifier = Modifier,
    onToggle: (Boolean) -> Unit,
    onPlayClick: () -> Unit,
    onMoveClick: () -> Unit,
    onSkipClick: () -> Unit
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Checkbox(
                checked = task.isCompleted,
                onCheckedChange = { onToggle(it) },
                colors = CheckboxDefaults.colors(
                    checkedColor = ObsidianPurple,
                    uncheckedColor = ObsidianTextMuted,
                    checkmarkColor = ObsidianBg
                ),
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = task.text,
                color = if (task.isCompleted) ObsidianTextMuted else ObsidianTextPrimary,
                fontSize = 13.sp,
                textDecoration = if (task.isCompleted) TextDecoration.LineThrough else TextDecoration.None
            )
        }

        if (!task.isCompleted) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                // Circle 1: Play/Start (Quick start default 15m session)
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(ObsidianBg)
                        .border(1.dp, ObsidianBorder, CircleShape)
                        .clickable { onPlayClick() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.PlayArrow,
                        contentDescription = "Quick Start Timer",
                        tint = ObsidianTextDark,
                        modifier = Modifier.size(10.dp)
                    )
                }

                // Circle 2: Move to Timed (Focus Blocks)
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(ObsidianBg)
                        .border(1.dp, ObsidianBorder, CircleShape)
                        .clickable { onMoveClick() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.KeyboardArrowUp,
                        contentDescription = "Move to Focus Blocks",
                        tint = ObsidianTextDark,
                        modifier = Modifier.size(12.dp)
                    )
                }

                // Circle 3: Skip / Not Today
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(ObsidianBg)
                        .border(1.dp, ObsidianBorder, CircleShape)
                        .clickable { onSkipClick() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Delete,
                        contentDescription = "Skip Task",
                        tint = ObsidianTextDark,
                        modifier = Modifier.size(10.dp)
                    )
                }
            }
        }
    }
}

class DragDropState {
    var draggedTask by mutableStateOf<Task?>(null)
    var dragPosition by mutableStateOf(Offset.Zero)
    var isDragging by mutableStateOf(false)
}

@Composable
fun NativeTimelineGridView(
    tasks: List<Task>,
    onStartTimer: (Task) -> Unit,
    onToggleTask: (Task) -> Unit,
    modifier: Modifier = Modifier
) {
    var zoomLevel by remember { mutableIntStateOf(60) }
    val scrollState = rememberScrollState()
    val scope = rememberCoroutineScope()

    val timedTasks = remember(tasks) {
        tasks.mapNotNull { task ->
            val timeSource = listOfNotNull(task.timeRange, task.displayTitle, task.text, task.rawMarkdownLine).firstOrNull { it.contains(":") } ?: ""
            if (timeSource.isNotEmpty()) {
                val regex = Regex("""(\d{1,2}):(\d{2})\s*([aApP][mM])?\s*[\-–—~]\s*(\d{1,2}):(\d{2})\s*([aApP][mM])?""")
                val match = regex.find(timeSource)
                if (match != null) {
                    var sh = match.groupValues[1].toIntOrNull() ?: 0
                    val sm = match.groupValues[2].toIntOrNull() ?: 0
                    val sAmpm = match.groupValues[3].lowercase()

                    var eh = match.groupValues[4].toIntOrNull() ?: 0
                    val em = match.groupValues[5].toIntOrNull() ?: 0
                    val eAmpm = match.groupValues[6].lowercase()

                    if (sAmpm == "pm" && sh < 12) sh += 12
                    if (sAmpm == "am" && sh == 12) sh = 0
                    if (eAmpm == "pm" && eh < 12) eh += 12
                    if (eAmpm == "am" && eh == 12) eh = 0

                    if (sAmpm == "pm" && eAmpm.isEmpty() && eh < 12) eh += 12
                    if (eAmpm == "pm" && sAmpm.isEmpty() && sh < 12) sh += 12

                    val startMins = sh * 60 + sm
                    val endMins = Math.max(startMins + 15, eh * 60 + em)
                    return@mapNotNull Triple(task, startMins, endMins)
                }
            }
            null
        }
    }

    val untimedTasks = remember(tasks, timedTasks) {
        val timedIds = timedTasks.map { it.first.id }.toSet()
        tasks.filter { task ->
            task.id !in timedIds &&
            task.parentLineNumber == null &&
            !task.isCompleted
        }
    }

    val subtasksByParent = remember(tasks) {
        tasks.filter { it.parentLineNumber != null }
            .groupBy { it.parentLineNumber!! }
    }

    var minHour = 5
    var maxHour = 22
    timedTasks.forEach { (_, startMins, endMins) ->
        val sH = startMins / 60
        val eH = (endMins + 59) / 60
        if (sH < minHour) minHour = Math.max(0, sH)
        if (eH > maxHour) maxHour = Math.min(23, eH)
    }

    val hourHeightDp = zoomLevel.dp

    Column(modifier = modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "TIMELINE GRID",
                color = com.example.ui.theme.ObsidianPurple,
                fontSize = 11.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 1.sp
            )

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier
                    .background(com.example.ui.theme.ObsidianSurface, RoundedCornerShape(8.dp))
                    .border(1.dp, com.example.ui.theme.ObsidianBorder, RoundedCornerShape(8.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            ) {
                IconButton(
                    onClick = { zoomLevel = Math.max(40, zoomLevel - 20) },
                    modifier = Modifier.size(28.dp)
                ) {
                    Text("🔍−", fontSize = 11.sp, color = com.example.ui.theme.ObsidianTextPrimary)
                }
                Text("${zoomLevel}px/h", fontSize = 11.sp, color = com.example.ui.theme.ObsidianTextMuted, fontWeight = FontWeight.Bold)
                IconButton(
                    onClick = { zoomLevel = Math.min(240, zoomLevel + 20) },
                    modifier = Modifier.size(28.dp)
                ) {
                    Text("🔍+", fontSize = 11.sp, color = com.example.ui.theme.ObsidianTextPrimary)
                }
                Button(
                    onClick = {
                        zoomLevel = 130
                        val cal = java.util.Calendar.getInstance()
                        val currentMins = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
                        val targetPx = kotlin.math.max(0f, (currentMins - minHour * 60) * (130f / 60f))
                        scope.launch { scrollState.animateScrollTo(targetPx.toInt()) }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = com.example.ui.theme.ObsidianPurple.copy(alpha = 0.2f), contentColor = com.example.ui.theme.ObsidianPurple),
                    shape = RoundedCornerShape(6.dp),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                    modifier = Modifier.height(26.dp)
                ) {
                    Text("🎯 Focus", fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        if (untimedTasks.isNotEmpty()) {
            var untimedExpanded by remember { mutableStateOf(true) }
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp)
                    .border(1.dp, com.example.ui.theme.ObsidianBorder, RoundedCornerShape(8.dp)),
                colors = CardDefaults.cardColors(containerColor = com.example.ui.theme.ObsidianSurface)
            ) {
                Column {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { untimedExpanded = !untimedExpanded }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "📦 Untimed Tasks (${untimedTasks.size})",
                            color = com.example.ui.theme.ObsidianPurple,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(if (untimedExpanded) "▲" else "▼", color = com.example.ui.theme.ObsidianTextMuted, fontSize = 10.sp)
                    }

                    if (untimedExpanded) {
                        Column(modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            untimedTasks.forEach { task ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .background(com.example.ui.theme.ObsidianBg, RoundedCornerShape(6.dp))
                                        .padding(horizontal = 8.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = task.displayTitle.ifEmpty { task.text },
                                        color = com.example.ui.theme.ObsidianTextPrimary,
                                        fontSize = 12.sp,
                                        modifier = Modifier.weight(1f)
                                    )
                                    IconButton(onClick = { onStartTimer(task) }, modifier = Modifier.size(24.dp)) {
                                        Text("▶", color = ObsidianAccentGreen, fontSize = 10.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(RoundedCornerShape(12.dp))
                .background(com.example.ui.theme.ObsidianSurface)
                .border(1.dp, com.example.ui.theme.ObsidianBorder, RoundedCornerShape(12.dp))
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(scrollState)
            ) {
                val totalHours = maxHour - minHour + 1
                val totalCanvasHeight = hourHeightDp * totalHours

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(totalCanvasHeight)
                ) {
                    Row(modifier = Modifier.fillMaxSize()) {
                        Column(
                            modifier = Modifier
                                .width(54.dp)
                                .fillMaxHeight()
                                .background(Color.Black.copy(alpha = 0.3f))
                        ) {
                            for (h in minHour..maxHour) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(hourHeightDp),
                                    contentAlignment = Alignment.TopEnd
                                ) {
                                    val displayH = if (h == 0) 12 else if (h > 12) h - 12 else h
                                    val ampm = if (h >= 12) "PM" else "AM"
                                    Text(
                                        text = "$displayH $ampm",
                                        color = com.example.ui.theme.ObsidianTextMuted,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.padding(end = 6.dp, top = 2.dp)
                                    )
                                }
                            }
                        }

                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxHeight()
                        ) {
                            for (i in 0 until totalHours) {
                                val topOffset = hourHeightDp * i
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(1.dp)
                                        .offset(y = topOffset)
                                        .background(com.example.ui.theme.ObsidianBorder)
                                )
                            }
                        }
                    }

                    timedTasks.forEach { (task, startMins, endMins) ->
                        val startOffsetMins = startMins - (minHour * 60)
                        val durationMins = Math.max(15, endMins - startMins)

                        val topDp = (startOffsetMins.toFloat() / 60f) * zoomLevel
                        val cardHeightDp = Math.max(32f, (durationMins.toFloat() / 60f) * zoomLevel)

                        val subtasks = subtasksByParent[task.lineNumber] ?: emptyList()
                        val extraHeightDp = if (subtasks.isNotEmpty()) subtasks.size * 22f else 0f
                        val finalCardHeightDp = Math.max(cardHeightDp, 32f + extraHeightDp)

                        Card(
                            modifier = Modifier
                                .padding(start = 60.dp, end = 8.dp)
                                .fillMaxWidth()
                                .height(finalCardHeightDp.dp)
                                .offset(y = topDp.dp)
                                .border(1.dp, com.example.ui.theme.ObsidianPurple, RoundedCornerShape(8.dp)),
                            colors = CardDefaults.cardColors(containerColor = com.example.ui.theme.ObsidianPurple.copy(alpha = 0.25f)),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(horizontal = 8.dp, vertical = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.Top
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = task.displayTitle.ifEmpty { task.text },
                                        color = com.example.ui.theme.ObsidianTextPrimary,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = "${durationMins}m",
                                        color = com.example.ui.theme.ObsidianTextMuted,
                                        fontSize = 10.sp
                                    )

                                    if (subtasks.isNotEmpty()) {
                                        Column(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(top = 4.dp),
                                            verticalArrangement = Arrangement.spacedBy(2.dp)
                                        ) {
                                            subtasks.forEach { sub ->
                                                Row(
                                                    modifier = Modifier.fillMaxWidth(),
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.SpaceBetween
                                                ) {
                                                    Row(
                                                        verticalAlignment = Alignment.CenterVertically,
                                                        modifier = Modifier
                                                            .weight(1f)
                                                            .clickable { onToggleTask(sub) }
                                                    ) {
                                                        Text(
                                                            text = if (sub.isCompleted) "☑ " else "☐ ",
                                                            color = if (sub.isCompleted) ObsidianAccentGreen else com.example.ui.theme.ObsidianTextMuted,
                                                            fontSize = 10.sp
                                                        )
                                                        Text(
                                                            text = sub.displayTitle.ifEmpty { sub.text },
                                                            color = if (sub.isCompleted) com.example.ui.theme.ObsidianTextMuted else com.example.ui.theme.ObsidianTextPrimary,
                                                            fontSize = 10.sp,
                                                            textDecoration = if (sub.isCompleted) TextDecoration.LineThrough else TextDecoration.None,
                                                            maxLines = 1,
                                                            overflow = TextOverflow.Ellipsis
                                                        )
                                                    }
                                                    IconButton(
                                                        onClick = { onStartTimer(sub) },
                                                        modifier = Modifier.size(20.dp)
                                                    ) {
                                                        Text("▶", color = ObsidianAccentGreen, fontSize = 8.sp)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                IconButton(
                                    onClick = { onStartTimer(task) },
                                    modifier = Modifier.size(28.dp)
                                ) {
                                    Text("▶", color = ObsidianAccentGreen, fontSize = 12.sp)
                                }
                            }
                        }
                    }

                    val cal = java.util.Calendar.getInstance()
                    val currentH = cal.get(java.util.Calendar.HOUR_OF_DAY)
                    val currentM = cal.get(java.util.Calendar.MINUTE)
                    if (currentH in minHour..maxHour) {
                        val currentOffsetMins = (currentH - minHour) * 60 + currentM
                        val laserTopDp = (currentOffsetMins.toFloat() / 60f) * zoomLevel

                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(2.dp)
                                .offset(y = laserTopDp.dp)
                                .background(Color(0xFFFF453A))
                        )
                    }
                }
            }
        }
    }
}

