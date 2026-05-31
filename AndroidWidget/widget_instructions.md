# KWGT Interactive Widget Design & Configuration Guide

This guide details how to build a premium, glassmorphic home screen widget using **KWGT** linked with your **Tasker** project.

---

## 🎨 Design Specification (Dark Glassmorphism)

*   **Widget Size**: 4x2 or 4x3 (highly recommended for a clean layout)
*   **Background**: Rounded rectangle (Corner radius: `24px`), Paint Color: `#B01C1C1E` (Semi-transparent dark grey), FX: Background Blur enabled (if launcher supports it).
*   **Border**: Stroke size: `2px`, Paint Color: `#20FFFFFF` (Low opacity white outline for a sleek glass look).
*   **Fonts**: *Inter*, *Roboto*, or *Product Sans* (bold weight for headings, regular for details).

---

## 📊 Kustom copy-pasteable Formulas

Use these Kustom expressions inside KWGT to link text elements, progress bars, and colors to your Tasker automation data:

### 1. Current Active Task Name
*   *Text property*:
    ```kustom
    $tc(ell, br(tasker, "TbCurrentTask"), 30)$
    ```
    *Truncates task names longer than 30 characters with an ellipsis to prevent UI clipping.*

### 2. Time Range (Start - End)
*   *Text property*:
    ```kustom
    $if(br(tasker, "TbCurrentTime") != "", br(tasker, "TbCurrentTime"), "No active timeblock")$
    ```

### 3. Countdown Timer (MM:SS)
*   *Text property*:
    ```kustom
    $if(br(tasker, "TbTimerActive") = 1,
        tf(gv(target_epoch) - df(S), "mm:ss"),
        tf(mu(num, br(tasker, "TbCurrentDuration")) * 60, "mm:ss")
    )$
    ```
*   *Global Variable dependency*: To make it clean, define a Global Text variable in KWGT named `target_epoch` with this formula:
    ```kustom
    $mu(num, br(tasker, "TbTimerStartEpoch")) + mu(num, br(tasker, "TbTimerDurationSeconds"))$
    ```

### 4. Circular/Horizontal Progress Bar
*   *Progress type*: Custom
*   *Max property*: `$mu(num, br(tasker, "TbTimerDurationSeconds"))$`
*   *Level property*:
    ```kustom
    $if(br(tasker, "TbTimerActive") = 1,
        mu(max, 0, mu(num, br(tasker, "TbTimerDurationSeconds")) - (df(S) - mu(num, br(tasker, "TbTimerStartEpoch")))),
        mu(num, br(tasker, "TbCurrentDuration")) * 60
    )$
    ```

### 5. Status / Accent Indicator
*   *Text indicator*:
    ```kustom
    $if(br(tasker, "TbTimerActive") = 1, "● FOCUSING", "○ IDLE")$
    ```
*   *Color property (for text or icons)*:
    ```kustom
    $if(br(tasker, "TbTimerActive") = 1, #FF00FFD0, #FF8E8E93)$
    ```
    *Uses neon cyan (#00ffd0) for active focus state and silver-grey for idle.*

### 6. Today's Upcoming Timeblocked Schedule
*   *Text property* (multi-line layout for displaying the next 3 items):
    ```kustom
    $br(tasker, "TbScheduleSummary")$
    ```

---

## 👆 Binding Interactive Touch Controls

To make the widget buttons trigger the focus timer and sync controls on your phone:

1.  Add an **Icon** or **Shape** to serve as a button in your KWGT hierarchy (e.g. Play, Pause, Checkmark, Sync).
2.  Select the item, go to the **Touch** tab, and tap **Add**.
3.  Set **Action** to `Launch Shortcut`.
4.  Tap **Shortcut** and select **Tasker Shortcut** from the list.
5.  In the Tasker config window that pops up, select the appropriate task:
    *   **Play/Start Button** ➔ Select `Timeblocker_Start` (Starts or resumes the countdown timer)
    *   **Pause Button** ➔ Select `Timeblocker_Pause` (Pauses active timer and locks elapsed time)
    *   **Complete Button** ➔ Select `Timeblocker_Complete` (Marks task as `- [x]` in daily note, updates Todoist/Google Tasks API, and resets timer)
    *   **Postpone Button** ➔ Select `Timeblocker_Postpone` (Appends `#postpone` to task in note for PC rescheduling, and resets timer)
    *   **Not Today Button** ➔ Select `Timeblocker_NotToday` (Cancels task in note by marking it `- [-]`, and resets timer)
    *   **Sync/Refresh Button** ➔ Select `Timeblocker_Init` (Triggers note re-reading and forces variable update)
6.  (Optional) For the Tasker shortcut parameters, you do not need to pass anything. Tasker will read your Obsidian note directly.

---

## 🚨 Background Timer & Alarm Overlay

*   When you tap the **Play/Start** or **Resume** button, Tasker starts a background watchdog task (`Timeblocker_TimerWatcher`) matching your active focus block's remaining duration.
*   Once the timer hits 0:
    1.  The phone **vibrates** for 1 second.
    2.  An **audible alarm** plays.
    3.  A system notification **"Obsidian Task Timer"** is created.
*   To stop the alarm sound/vibrate, simply unlock your phone and tap any of the widget control buttons (**Complete**, **Pause**, **Postpone**, **Not Today**, or **Start**). Tapping any button immediately stops the ringtone and clears the notification.
