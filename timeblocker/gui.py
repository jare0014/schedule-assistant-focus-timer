"""
gui.py - Interactive Tkinter GUI preview for inspecting and adjusting the proposed schedule.
"""

from typing import List, Dict, Any

try:
    import tkinter as tk
    from tkinter import messagebox, scrolledtext
except ImportError:
    tk = None
    messagebox = None
    scrolledtext = None

from .preferences import load_preferences, save_preferences
from .scheduler import generate_schedule
from .writer import write_to_daily_note, copy_to_clipboard


class ScheduleApp:
    def __init__(
        self,
        events: List[Dict[str, Any]],
        tasks: List[Dict[str, Any]],
        google_tasks: List[Dict[str, Any]],
        daily_tasks: List[str],
        tz,
        note_path: str,
        headers: List[str],
        initial_schedule: str
    ):
        if tk is None:
            raise RuntimeError("Tkinter is not available in the current Python environment.")

        self.events = events
        self.tasks = tasks
        self.google_tasks = google_tasks
        self.daily_tasks = daily_tasks
        self.tz = tz
        self.note_path = note_path
        self.headers = headers
        self.current_schedule = initial_schedule

        self.root = tk.Tk()
        self.root.title("Schedule Assistant with Focus Timer")
        self.root.geometry("700x820")
        self.root.configure(bg="#1e1e1e")

        # Center the window and bring to front
        self.root.eval('tk::PlaceWindow . center')
        self.root.lift()
        self.root.attributes('-topmost', True)
        self.root.after_idle(self.root.attributes, '-topmost', False)

        # UI Styling
        self.title_font = ("Segoe UI", 12, "bold")
        self.body_font = ("Segoe UI", 10)
        self.code_font = ("Consolas", 11)

        # Title Header
        lbl_title = tk.Label(
            self.root,
            text="Proposed Categorized Daily Schedule",
            fg="#ffffff",
            bg="#1e1e1e",
            font=self.title_font
        )
        lbl_title.pack(pady=(12, 2))

        lbl_instructions = tk.Label(
            self.root,
            text="Feel free to edit the text box manually or type feedback below to adjust it via Gemini.",
            fg="#bbbbbb",
            bg="#1e1e1e",
            font=("Segoe UI", 9)
        )
        lbl_instructions.pack(pady=(0, 10))

        # Text Area for Schedule Preview
        self.preview_area = scrolledtext.ScrolledText(
            self.root,
            width=80,
            height=18,
            bg="#252526",
            fg="#d4d4d4",
            insertbackground="white",
            font=self.code_font,
            relief=tk.FLAT
        )
        self.preview_area.pack(pady=5, padx=20, fill=tk.BOTH, expand=True)
        self.update_preview_display()

        # Feedback Section
        lbl_feedback = tk.Label(
            self.root,
            text="Adjustments / Instructions for this run:",
            fg="#ffffff",
            bg="#1e1e1e",
            font=("Segoe UI", 10, "bold")
        )
        lbl_feedback.pack(anchor="w", padx=20, pady=(12, 2))

        self.feedback_entry = tk.Entry(
            self.root,
            bg="#252526",
            fg="#ffffff",
            insertbackground="white",
            font=self.body_font,
            relief=tk.FLAT,
            borderwidth=8
        )
        self.feedback_entry.pack(pady=5, padx=20, fill=tk.X)
        self.feedback_entry.focus_set()

        # Bind enter key to update schedule
        self.feedback_entry.bind("<Return>", lambda event: self.regenerate())

        # Persistent Preferences Section
        lbl_prefs = tk.Label(
            self.root,
            text="Persistent Preferences & Custom Instructions (Autosaved):",
            fg="#ffffff",
            bg="#1e1e1e",
            font=("Segoe UI", 10, "bold")
        )
        lbl_prefs.pack(anchor="w", padx=20, pady=(12, 2))

        self.prefs_area = scrolledtext.ScrolledText(
            self.root,
            width=80,
            height=4,
            bg="#252526",
            fg="#cccccc",
            insertbackground="white",
            font=self.body_font,
            relief=tk.FLAT
        )
        self.prefs_area.pack(pady=5, padx=20, fill=tk.X)
        self.load_preferences_to_ui()

        # Status Bar
        self.status_var = tk.StringVar(value="Status: Ready")
        self.lbl_status = tk.Label(
            self.root,
            textvariable=self.status_var,
            fg="#00ffd0",
            bg="#1e1e1e",
            font=("Segoe UI", 9, "italic")
        )
        self.lbl_status.pack(pady=5)

        # Button bar
        btn_frame = tk.Frame(self.root, bg="#1e1e1e")
        btn_frame.pack(pady=(10, 20))

        btn_update = tk.Button(
            btn_frame,
            text="Regenerate / Adjust",
            command=self.regenerate,
            bg="#0d6efd",
            fg="white",
            activebackground="#0b5ed7",
            activeforeground="white",
            font=self.body_font,
            padx=12,
            pady=6,
            relief=tk.FLAT
        )
        btn_update.pack(side=tk.LEFT, padx=8)

        btn_apply = tk.Button(
            btn_frame,
            text="Write to Daily Note",
            command=self.apply,
            bg="#198754",
            fg="white",
            activebackground="#157347",
            activeforeground="white",
            font=self.body_font,
            padx=12,
            pady=6,
            relief=tk.FLAT
        )
        btn_apply.pack(side=tk.LEFT, padx=8)

        btn_cancel = tk.Button(
            btn_frame,
            text="Cancel",
            command=self.cancel,
            bg="#6c757d",
            fg="white",
            activebackground="#5c636a",
            activeforeground="white",
            font=self.body_font,
            padx=12,
            pady=6,
            relief=tk.FLAT
        )
        btn_cancel.pack(side=tk.LEFT, padx=8)

    def update_preview_display(self):
        self.preview_area.delete("1.0", tk.END)
        self.preview_area.insert(tk.END, self.current_schedule)

    def load_preferences_to_ui(self):
        prefs = load_preferences()
        self.prefs_area.delete("1.0", tk.END)
        self.prefs_area.insert(tk.END, prefs)

    def save_preferences_from_ui(self) -> str:
        prefs = self.prefs_area.get("1.0", tk.END).strip()
        save_preferences(prefs)
        return prefs

    def regenerate(self):
        feedback = self.feedback_entry.get().strip()
        if not feedback:
            feedback = "Apply updated custom preferences."

        self.status_var.set("Status: Generating schedule adjustments...")
        self.root.update_idletasks()

        prefs = self.save_preferences_from_ui()
        edited_schedule = self.preview_area.get("1.0", tk.END).strip()

        try:
            new_schedule = generate_schedule(
                self.events, self.tasks, self.google_tasks, self.daily_tasks, self.tz,
                feedback=feedback, previous_schedule=edited_schedule, user_preferences=prefs
            )
            if new_schedule:
                self.current_schedule = new_schedule
                self.update_preview_display()
                self.feedback_entry.delete(0, tk.END)
                self.status_var.set("Status: Schedule updated successfully!")
            else:
                self.status_var.set("Status: Failed to update schedule (empty response).")
        except Exception as e:
            self.status_var.set("Status: Error during generation.")
            messagebox.showerror("Error", f"Failed to regenerate schedule:\n{e}")

    def apply(self):
        self.save_preferences_from_ui()
        final_schedule = self.preview_area.get("1.0", tk.END).strip()

        if write_to_daily_note(self.note_path, final_schedule, self.headers):
            messagebox.showinfo("Success", "Daily Note successfully updated!")
            self.root.destroy()
        else:
            messagebox.showwarning("Warning", "Could not update Daily Note file. Copying to clipboard instead...")
            copy_to_clipboard(final_schedule)
            self.root.destroy()

    def cancel(self):
        self.root.destroy()

    def run(self):
        self.root.mainloop()
