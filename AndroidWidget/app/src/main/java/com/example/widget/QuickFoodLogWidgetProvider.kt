package com.example.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.RemoteViews
import android.widget.Toast
import com.example.R
import com.example.data.ObsidianSyncRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class QuickFoodLogWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_QUICK_LOG = "com.example.widget.ACTION_QUICK_LOG"
        const val EXTRA_FOOD_ID    = "extra_food_id"

        private val FOOD_ITEMS = listOf(
            Triple(R.id.food_btn_water,    "water",           "Water 💧"),
            Triple(R.id.food_btn_espresso, "espresso",        "Espresso ☕"),
            Triple(R.id.food_btn_waffles,  "protein_waffles", "Protein Waffles 🧇"),
            Triple(R.id.food_btn_shake,    "protein_shake",   "Protein Shake 🥤"),
            Triple(R.id.food_btn_nuts,     "mixed_nuts",      "Mixed Nuts 🥜")
        )
    }

    private fun updateWidgetSync(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.quick_food_log_widget)

            for ((btnId, foodId, _) in FOOD_ITEMS) {
                val intent = Intent(context, QuickFoodLogWidgetProvider::class.java).apply {
                    action = ACTION_QUICK_LOG
                    putExtra(EXTRA_FOOD_ID, foodId)
                }
                val pi = PendingIntent.getBroadcast(
                    context,
                    btnId + appWidgetId * 10,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(btnId, pi)
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val pendingResult = try { goAsync() } catch (e: Exception) { null }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                updateWidgetSync(context, appWidgetManager, appWidgetIds)
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                pendingResult?.finish()
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.action ?: return

        if (action == ACTION_QUICK_LOG) {
            val foodId = intent.getStringExtra(EXTRA_FOOD_ID) ?: return
            val foodLabel = FOOD_ITEMS.firstOrNull { it.second == foodId }?.third ?: foodId
            val pr = try { goAsync() } catch (e: Exception) { null }

            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val repo = ObsidianSyncRepository(context)
                    val success = repo.quickLog(foodId)
                    Handler(Looper.getMainLooper()).post {
                        if (success) {
                            Toast.makeText(context, "Logged $foodLabel! 🥑", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(context, "Failed to log $foodLabel. Check server connection.", Toast.LENGTH_SHORT).show()
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                } finally {
                    pr?.finish()
                }
            }
        }
    }
}
