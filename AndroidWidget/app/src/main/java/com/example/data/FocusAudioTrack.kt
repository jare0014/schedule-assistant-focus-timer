package com.example.data

data class FocusAudioTrack(
    val label: String,
    val url: String,
    val streamUrl: String? = null,
    val type: String = "local", // "local", "youtube", "spotify", "external_web", "web"
    val isInternal: Boolean = false,
    val videoId: String? = null,
    val playlistId: String? = null
)
