export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      assignment_date_overrides: {
        Row: {
          assignment_id: string
          date: string
          id: string
          workout_id: string | null
        }
        Insert: {
          assignment_id: string
          date: string
          id?: string
          workout_id?: string | null
        }
        Update: {
          assignment_id?: string
          date?: string
          id?: string
          workout_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignment_date_overrides_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_date_overrides_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          active: boolean
          client_id: string
          created_at: string
          id: string
          program_id: string
          start_date: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          client_id: string
          created_at?: string
          id?: string
          program_id: string
          start_date: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          client_id?: string
          created_at?: string
          id?: string
          program_id?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      body_measurements: {
        Row: {
          arm_in: number | null
          chest_in: number | null
          client_id: string
          created_at: string
          date: string
          hips_in: number | null
          id: string
          neck_in: number | null
          thigh_in: number | null
          waist_in: number | null
          weight_lbs: number | null
        }
        Insert: {
          arm_in?: number | null
          chest_in?: number | null
          client_id: string
          created_at?: string
          date: string
          hips_in?: number | null
          id?: string
          neck_in?: number | null
          thigh_in?: number | null
          waist_in?: number | null
          weight_lbs?: number | null
        }
        Update: {
          arm_in?: number | null
          chest_in?: number | null
          client_id?: string
          created_at?: string
          date?: string
          hips_in?: number | null
          id?: string
          neck_in?: number | null
          thigh_in?: number | null
          waist_in?: number | null
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "body_measurements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      change_requests: {
        Row: {
          client_id: string
          coach_id: string
          from_date: string
          id: string
          requested_at: string
          responded_at: string | null
          status: Database["public"]["Enums"]["change_request_status"]
          to_date: string
          workout_id: string | null
        }
        Insert: {
          client_id: string
          coach_id: string
          from_date: string
          id?: string
          requested_at?: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["change_request_status"]
          to_date: string
          workout_id?: string | null
        }
        Update: {
          client_id?: string
          coach_id?: string
          from_date?: string
          id?: string
          requested_at?: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["change_request_status"]
          to_date?: string
          workout_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "change_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      client_summaries: {
        Row: {
          active_goal_count: number
          client_id: string
          coach_id: string
          disabled: boolean
          display_name: string | null
          email: string | null
          goals_completed_today: number
          has_program: boolean
          last_message_at: string | null
          streak: number
          today_workout_name: string | null
          unread_for_coach: boolean
          updated_at: string
          workout_done: boolean
        }
        Insert: {
          active_goal_count?: number
          client_id: string
          coach_id: string
          disabled?: boolean
          display_name?: string | null
          email?: string | null
          goals_completed_today?: number
          has_program?: boolean
          last_message_at?: string | null
          streak?: number
          today_workout_name?: string | null
          unread_for_coach?: boolean
          updated_at?: string
          workout_done?: boolean
        }
        Update: {
          active_goal_count?: number
          client_id?: string
          coach_id?: string
          disabled?: boolean
          display_name?: string | null
          email?: string | null
          goals_completed_today?: number
          has_program?: boolean
          last_message_at?: string | null
          streak?: number
          today_workout_name?: string | null
          unread_for_coach?: boolean
          updated_at?: string
          workout_done?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "client_summaries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_logs: {
        Row: {
          created_at: string
          exercise_id: string | null
          exercise_name: string
          id: string
          mode: Database["public"]["Enums"]["exercise_mode"]
          prescribed: Json | null
          sort_order: number | null
          workout_log_id: string
        }
        Insert: {
          created_at?: string
          exercise_id?: string | null
          exercise_name: string
          id?: string
          mode?: Database["public"]["Enums"]["exercise_mode"]
          prescribed?: Json | null
          sort_order?: number | null
          workout_log_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string | null
          exercise_name?: string
          id?: string
          mode?: Database["public"]["Enums"]["exercise_mode"]
          prescribed?: Json | null
          sort_order?: number | null
          workout_log_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_logs_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_logs_workout_log_id_fkey"
            columns: ["workout_log_id"]
            isOneToOne: false
            referencedRelation: "workout_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          default_duration_seconds: number | null
          default_miles: number | null
          default_mode: Database["public"]["Enums"]["exercise_mode"] | null
          default_reps: number | null
          default_sets: number | null
          id: string
          image_url: string | null
          name: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          default_duration_seconds?: number | null
          default_miles?: number | null
          default_mode?: Database["public"]["Enums"]["exercise_mode"] | null
          default_reps?: number | null
          default_sets?: number | null
          id?: string
          image_url?: string | null
          name: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          default_duration_seconds?: number | null
          default_miles?: number | null
          default_mode?: Database["public"]["Enums"]["exercise_mode"] | null
          default_reps?: number | null
          default_sets?: number | null
          id?: string
          image_url?: string | null
          name?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercises_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          accepted_at: string | null
          client_id: string
          coach_id: string
          created_at: string
          friend_id: string
          member_names: Json | null
          pair_id: string
          requested_by: string
          shared_streak: number
          stats: Json | null
          stats_updated_at: string | null
          status: Database["public"]["Enums"]["friendship_status"]
        }
        Insert: {
          accepted_at?: string | null
          client_id: string
          coach_id: string
          created_at?: string
          friend_id: string
          member_names?: Json | null
          pair_id: string
          requested_by: string
          shared_streak?: number
          stats?: Json | null
          stats_updated_at?: string | null
          status?: Database["public"]["Enums"]["friendship_status"]
        }
        Update: {
          accepted_at?: string | null
          client_id?: string
          coach_id?: string
          created_at?: string
          friend_id?: string
          member_names?: Json | null
          pair_id?: string
          requested_by?: string
          shared_streak?: number
          stats?: Json | null
          stats_updated_at?: string | null
          status?: Database["public"]["Enums"]["friendship_status"]
        }
        Relationships: [
          {
            foreignKeyName: "friendships_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_friend_id_fkey"
            columns: ["friend_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_logs: {
        Row: {
          client_id: string
          completed_at: string
          date: string
          goal_id: string
          goal_text: string | null
          id: string
        }
        Insert: {
          client_id: string
          completed_at?: string
          date: string
          goal_id: string
          goal_text?: string | null
          id?: string
        }
        Update: {
          client_id?: string
          completed_at?: string
          date?: string
          goal_id?: string
          goal_text?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_logs_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          active: boolean
          archived_at: string | null
          archived_by: string | null
          client_id: string
          created_at: string
          id: string
          locked: boolean
          set_by: string | null
          text: string
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          archived_by?: string | null
          client_id: string
          created_at?: string
          id?: string
          locked?: boolean
          set_by?: string | null
          text: string
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          archived_by?: string | null
          client_id?: string
          created_at?: string
          id?: string
          locked?: boolean
          set_by?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          id: string
          read: boolean
          sender_id: string
          sent_at: string
          text: string
          thread_id: string
        }
        Insert: {
          id?: string
          read?: boolean
          sender_id: string
          sent_at?: string
          text: string
          thread_id: string
        }
        Update: {
          id?: string
          read?: boolean
          sender_id?: string
          sent_at?: string
          text?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      motivation_entries: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          image_url: string | null
          quote: string
          week_start: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string | null
          quote: string
          week_start?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string | null
          quote?: string
          week_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "motivation_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: string
          kind: string
          last_error: string | null
          next_attempt_at: string
          payload: Json
          profile_id: string
          sent_at: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          profile_id: string
          sent_at?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          profile_id?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          disabled: boolean
          display_name: string | null
          email: string | null
          fcm_token: string | null
          height_in: number | null
          id: string
          invited_by: string | null
          last_reminder_date: string | null
          notification_time: string | null
          notifications_enabled: boolean
          role: Database["public"]["Enums"]["user_role"]
          sex: Database["public"]["Enums"]["sex"] | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          disabled?: boolean
          display_name?: string | null
          email?: string | null
          fcm_token?: string | null
          height_in?: number | null
          id: string
          invited_by?: string | null
          last_reminder_date?: string | null
          notification_time?: string | null
          notifications_enabled?: boolean
          role: Database["public"]["Enums"]["user_role"]
          sex?: Database["public"]["Enums"]["sex"] | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          disabled?: boolean
          display_name?: string | null
          email?: string | null
          fcm_token?: string | null
          height_in?: number | null
          id?: string
          invited_by?: string | null
          last_reminder_date?: string | null
          notification_time?: string | null
          notifications_enabled?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          sex?: Database["public"]["Enums"]["sex"] | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      program_phases: {
        Row: {
          active_days: Database["public"]["Enums"]["day_of_week"][]
          created_at: string
          id: string
          name: string | null
          program_id: string
          sort_order: number
          updated_at: string
          weeks: number | null
        }
        Insert: {
          active_days?: Database["public"]["Enums"]["day_of_week"][]
          created_at?: string
          id?: string
          name?: string | null
          program_id: string
          sort_order: number
          updated_at?: string
          weeks?: number | null
        }
        Update: {
          active_days?: Database["public"]["Enums"]["day_of_week"][]
          created_at?: string
          id?: string
          name?: string | null
          program_id?: string
          sort_order?: number
          updated_at?: string
          weeks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "program_phases_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
          weeks: number | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          weeks?: number | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          weeks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "programs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      progress_photos: {
        Row: {
          client_id: string
          created_at: string
          height: number | null
          id: string
          size_bytes: number | null
          storage_path: string
          taken_at: string | null
          thumb_url: string | null
          url: string | null
          width: number | null
        }
        Insert: {
          client_id: string
          created_at?: string
          height?: number | null
          id?: string
          size_bytes?: number | null
          storage_path: string
          taken_at?: string | null
          thumb_url?: string | null
          url?: string | null
          width?: number | null
        }
        Update: {
          client_id?: string
          created_at?: string
          height?: number | null
          id?: string
          size_bytes?: number | null
          storage_path?: string
          taken_at?: string | null
          thumb_url?: string | null
          url?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "progress_photos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string | null
          profile_id: string
          token: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string | null
          profile_id: string
          token: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string | null
          profile_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      set_logs: {
        Row: {
          actual_miles: number | null
          actual_seconds: number | null
          completed: boolean
          exercise_log_id: string
          id: string
          prescribed: Json | null
          reps: number | null
          set_number: number
          target_seconds: number | null
          weight: number | null
          weight_entered: boolean
          weight_unit: Database["public"]["Enums"]["weight_unit"] | null
        }
        Insert: {
          actual_miles?: number | null
          actual_seconds?: number | null
          completed?: boolean
          exercise_log_id: string
          id?: string
          prescribed?: Json | null
          reps?: number | null
          set_number: number
          target_seconds?: number | null
          weight?: number | null
          weight_entered?: boolean
          weight_unit?: Database["public"]["Enums"]["weight_unit"] | null
        }
        Update: {
          actual_miles?: number | null
          actual_seconds?: number | null
          completed?: boolean
          exercise_log_id?: string
          id?: string
          prescribed?: Json | null
          reps?: number | null
          set_number?: number
          target_seconds?: number | null
          weight?: number | null
          weight_entered?: boolean
          weight_unit?: Database["public"]["Enums"]["weight_unit"] | null
        }
        Relationships: [
          {
            foreignKeyName: "set_logs_exercise_log_id_fkey"
            columns: ["exercise_log_id"]
            isOneToOne: false
            referencedRelation: "exercise_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      threads: {
        Row: {
          client_id: string
          coach_id: string
          created_at: string
          id: string
          last_message: string | null
          last_message_at: string | null
          last_message_by: string | null
          unread_for_client: boolean
          unread_for_coach: boolean
          updated_at: string
        }
        Insert: {
          client_id: string
          coach_id: string
          created_at?: string
          id?: string
          last_message?: string | null
          last_message_at?: string | null
          last_message_by?: string | null
          unread_for_client?: boolean
          unread_for_coach?: boolean
          updated_at?: string
        }
        Update: {
          client_id?: string
          coach_id?: string
          created_at?: string
          id?: string
          last_message?: string | null
          last_message_at?: string | null
          last_message_by?: string | null
          unread_for_client?: boolean
          unread_for_coach?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_last_message_by_fkey"
            columns: ["last_message_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      week_schedules: {
        Row: {
          day_of_week: Database["public"]["Enums"]["day_of_week"]
          id: string
          phase_id: string | null
          program_id: string | null
          week_number: number
          workout_id: string | null
        }
        Insert: {
          day_of_week: Database["public"]["Enums"]["day_of_week"]
          id?: string
          phase_id?: string | null
          program_id?: string | null
          week_number: number
          workout_id?: string | null
        }
        Update: {
          day_of_week?: Database["public"]["Enums"]["day_of_week"]
          id?: string
          phase_id?: string | null
          program_id?: string | null
          week_number?: number
          workout_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "week_schedules_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "program_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "week_schedules_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "week_schedules_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_exercises: {
        Row: {
          exercise_id: string | null
          id: string
          mode: Database["public"]["Enums"]["exercise_mode"]
          notes: string | null
          rest_seconds: number | null
          set_configs: Json
          sort_order: number
          workout_id: string
        }
        Insert: {
          exercise_id?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["exercise_mode"]
          notes?: string | null
          rest_seconds?: number | null
          set_configs?: Json
          sort_order: number
          workout_id: string
        }
        Update: {
          exercise_id?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["exercise_mode"]
          notes?: string | null
          rest_seconds?: number | null
          set_configs?: Json
          sort_order?: number
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_exercises_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_logs: {
        Row: {
          client_id: string
          completed: boolean
          completed_at: string | null
          created_at: string
          date: string
          difficulty: Database["public"]["Enums"]["workout_difficulty"] | null
          id: string
          next_day_feel: number | null
          updated_at: string
          warmup_completed: boolean
          workout_id: string | null
        }
        Insert: {
          client_id: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          date: string
          difficulty?: Database["public"]["Enums"]["workout_difficulty"] | null
          id?: string
          next_day_feel?: number | null
          updated_at?: string
          warmup_completed?: boolean
          workout_id?: string | null
        }
        Update: {
          client_id?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          date?: string
          difficulty?: Database["public"]["Enums"]["workout_difficulty"] | null
          id?: string
          next_day_feel?: number | null
          updated_at?: string
          warmup_completed?: boolean
          workout_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workout_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_logs_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      workouts: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          equipment: string[] | null
          estimated_duration_minutes: number | null
          id: string
          name: string
          type: Database["public"]["Enums"]["workout_type"]
          updated_at: string
          warmup_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          equipment?: string[] | null
          estimated_duration_minutes?: number | null
          id?: string
          name: string
          type?: Database["public"]["Enums"]["workout_type"]
          updated_at?: string
          warmup_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          equipment?: string[] | null
          estimated_duration_minutes?: number | null
          id?: string
          name?: string
          type?: Database["public"]["Enums"]["workout_type"]
          updated_at?: string
          warmup_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workouts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workouts_warmup_id_fkey"
            columns: ["warmup_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_change_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      apply_change_request_swap: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      assign_program: {
        Args: {
          p_client_id: string
          p_program_id: string
          p_start_date: string
        }
        Returns: string
      }
      client_today: { Args: { p_client_id: string }; Returns: string }
      compute_streak: {
        Args: { p_as_of?: string; p_client_id: string }
        Returns: number
      }
      copy_program_tree: {
        Args: {
          p_client_id: string
          p_name_suffix?: string
          p_program_id: string
        }
        Returns: string
      }
      duplicate_program: { Args: { p_program_id: string }; Returns: string }
      get_my_streak: { Args: never; Returns: number }
      get_workout_day: { Args: { p_date: string }; Returns: Json }
      get_workout_week: {
        Args: { p_days?: number; p_start_date: string }
        Returns: Json
      }
      is_coach: { Args: never; Returns: boolean }
      is_coach_of: { Args: { p_client_id: string }; Returns: boolean }
      list_coach_siblings: {
        Args: never
        Returns: {
          display_name: string
          id: string
        }[]
      }
      my_coach_id: { Args: never; Returns: string }
      program_delete_blockers: {
        Args: { p_program_id: string }
        Returns: number
      }
      prune_sent_outbox: { Args: never; Returns: undefined }
      recompute_friendship_stats: {
        Args: { p_pair_id: string }
        Returns: undefined
      }
      refresh_all_client_summaries: { Args: never; Returns: undefined }
      refresh_client_summary: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      reject_change_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      resolve_scheduled_workout: {
        Args: { p_client_id: string; p_date: string }
        Returns: string
      }
      run_daily_maintenance: { Args: never; Returns: undefined }
      run_hourly_reminders: { Args: never; Returns: undefined }
      run_reminders: { Args: never; Returns: undefined }
      save_program: {
        Args: {
          p_expected_updated_at?: string
          p_payload: Json
          p_program_id?: string
        }
        Returns: string
      }
      save_workout: {
        Args: {
          p_expected_updated_at?: string
          p_payload: Json
          p_workout_id?: string
        }
        Returns: string
      }
      save_workout_log: {
        Args: {
          p_completed: boolean
          p_date: string
          p_exercises: Json
          p_workout_id: string
        }
        Returns: string
      }
      send_message: {
        Args: { p_text: string; p_thread_client_id: string }
        Returns: Json
      }
      set_warmup_completed: {
        Args: { p_completed: boolean; p_date: string }
        Returns: undefined
      }
      workout_delete_blockers: {
        Args: { p_workout_id: string }
        Returns: number
      }
    }
    Enums: {
      change_request_status: "pending" | "accepted" | "rejected"
      day_of_week:
        | "monday"
        | "tuesday"
        | "wednesday"
        | "thursday"
        | "friday"
        | "saturday"
        | "sunday"
      exercise_mode: "reps" | "time" | "distance"
      friendship_status: "pending" | "accepted"
      sex: "male" | "female"
      user_role: "coach" | "client"
      weight_unit: "lbs" | "kg"
      workout_difficulty: "too_easy" | "challenging" | "overly_challenging"
      workout_type: "workout" | "warmup"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      change_request_status: ["pending", "accepted", "rejected"],
      day_of_week: [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ],
      exercise_mode: ["reps", "time", "distance"],
      friendship_status: ["pending", "accepted"],
      sex: ["male", "female"],
      user_role: ["coach", "client"],
      weight_unit: ["lbs", "kg"],
      workout_difficulty: ["too_easy", "challenging", "overly_challenging"],
      workout_type: ["workout", "warmup"],
    },
  },
} as const

