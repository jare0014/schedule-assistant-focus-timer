package com.example.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

private val DarkColorScheme =
  darkColorScheme(
    primary = ObsidianPurple,
    secondary = ObsidianTextMuted,
    tertiary = ObsidianAccentGreen,
    background = ObsidianBg,
    surface = ObsidianSurface,
    onBackground = ObsidianTextPrimary,
    onSurface = ObsidianTextPrimary,
    surfaceVariant = ObsidianBorder
  )

private val LightColorScheme = DarkColorScheme // Always use stunning dark theme for authentic obsidian styling

@Composable
fun MyApplicationTheme(
  darkTheme: Boolean = true, // Force Dark theme by default for Obsidian
  dynamicColor: Boolean = false, // Disable dynamic color to enforce branding
  content: @Composable () -> Unit,
) {
  val colorScheme = DarkColorScheme

  MaterialTheme(colorScheme = colorScheme, typography = Typography, content = content)
}
