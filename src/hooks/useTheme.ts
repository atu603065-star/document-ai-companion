// @ts-nocheck
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useTheme = (userId?: string) => {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    // First try localStorage for immediate load
    const saved = localStorage.getItem("chat-theme");
    if (saved === "light" || saved === "dark") return saved;
    return "dark";
  });

  // Apply theme on mount and when it changes
  useEffect(() => {
    if (theme === "light") {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
      document.documentElement.classList.add("dark");
    }
    localStorage.setItem("chat-theme", theme);
  }, [theme]);

  // Sync with database when user is available
  useEffect(() => {
    if (!userId) return;

    const fetchTheme = async () => {
      const { data } = await supabase
        .from("user_settings")
        .select("theme")
        .eq("user_id", userId)
        .maybeSingle();

      if (data?.theme && (data.theme === "light" || data.theme === "dark")) {
        setTheme(data.theme);
      }
    };

    fetchTheme();
  }, [userId]);

  const updateTheme = useCallback(async (newTheme: "dark" | "light") => {
    setTheme(newTheme);
    localStorage.setItem("chat-theme", newTheme);

    if (userId) {
      await supabase
        .from("user_settings")
        .upsert({ user_id: userId, theme: newTheme }, { onConflict: "user_id" });
    }
  }, [userId]);

  return { theme, setTheme: updateTheme };
};
