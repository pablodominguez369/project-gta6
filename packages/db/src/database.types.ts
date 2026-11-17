export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_type: string;
          created_at: string;
          id: string;
          object_id: string | null;
          object_type: string;
          request_id: string | null;
          safe_details: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_type: string;
          created_at?: string;
          id?: string;
          object_id?: string | null;
          object_type: string;
          request_id?: string | null;
          safe_details?: NonNullable<Json>;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_type?: string;
          created_at?: string;
          id?: string;
          object_id?: string | null;
          object_type?: string;
          request_id?: string | null;
          safe_details?: NonNullable<Json>;
        };
        Relationships: [];
      };
      channels: {
        Row: {
          created_at: string;
          created_by: string | null;
          display_name: string;
          id: string;
          max_posts_per_day: number;
          min_minutes_between_posts: number;
          mode: Database["public"]["Enums"]["channel_mode"];
          paused: boolean;
          paused_reason: string | null;
          platform: Database["public"]["Enums"]["platform"];
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          display_name: string;
          id?: string;
          max_posts_per_day?: number;
          min_minutes_between_posts?: number;
          mode?: Database["public"]["Enums"]["channel_mode"];
          paused?: boolean;
          paused_reason?: string | null;
          platform: Database["public"]["Enums"]["platform"];
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          display_name?: string;
          id?: string;
          max_posts_per_day?: number;
          min_minutes_between_posts?: number;
          mode?: Database["public"]["Enums"]["channel_mode"];
          paused?: boolean;
          paused_reason?: string | null;
          platform?: Database["public"]["Enums"]["platform"];
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      credential_refs: {
        Row: {
          channel_id: string;
          created_at: string;
          expires_at: string | null;
          granted_at: string | null;
          id: string;
          scopes: string[];
          secret_ref: string;
          status: Database["public"]["Enums"]["credential_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          channel_id: string;
          created_at?: string;
          expires_at?: string | null;
          granted_at?: string | null;
          id?: string;
          scopes?: string[];
          secret_ref: string;
          status?: Database["public"]["Enums"]["credential_status"];
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          created_at?: string;
          expires_at?: string | null;
          granted_at?: string | null;
          id?: string;
          scopes?: string[];
          secret_ref?: string;
          status?: Database["public"]["Enums"]["credential_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credential_refs_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      job_runs: {
        Row: {
          attempt: number;
          created_at: string;
          error_code: string | null;
          finished_at: string | null;
          id: string;
          job_name: string;
          queue_job_id: string | null;
          started_at: string | null;
          status: Database["public"]["Enums"]["job_run_status"];
          target_id: string | null;
          target_type: string | null;
        };
        ComputedFields: never;
        Insert: {
          attempt?: number;
          created_at?: string;
          error_code?: string | null;
          finished_at?: string | null;
          id?: string;
          job_name: string;
          queue_job_id?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["job_run_status"];
          target_id?: string | null;
          target_type?: string | null;
        };
        Update: {
          attempt?: number;
          created_at?: string;
          error_code?: string | null;
          finished_at?: string | null;
          id?: string;
          job_name?: string;
          queue_job_id?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["job_run_status"];
          target_id?: string | null;
          target_type?: string | null;
        };
        Relationships: [];
      };
      publications: {
        Row: {
          channel_id: string;
          created_at: string;
          created_by: string | null;
          error_code: string | null;
          external_id: string | null;
          id: string;
          idempotency_key: string;
          payload_json: NonNullable<Json>;
          permalink: string | null;
          published_at: string | null;
          scheduled_at: string | null;
          status: Database["public"]["Enums"]["publication_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          channel_id: string;
          created_at?: string;
          created_by?: string | null;
          error_code?: string | null;
          external_id?: string | null;
          id?: string;
          idempotency_key: string;
          payload_json?: NonNullable<Json>;
          permalink?: string | null;
          published_at?: string | null;
          scheduled_at?: string | null;
          status?: Database["public"]["Enums"]["publication_status"];
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          created_at?: string;
          created_by?: string | null;
          error_code?: string | null;
          external_id?: string | null;
          id?: string;
          idempotency_key?: string;
          payload_json?: NonNullable<Json>;
          permalink?: string | null;
          published_at?: string | null;
          scheduled_at?: string | null;
          status?: Database["public"]["Enums"]["publication_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "publications_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      system_controls: {
        Row: {
          daily_spend_limit_eur: number;
          global_paused: boolean;
          id: boolean;
          monthly_spend_limit_eur: number;
          paused_reason: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          daily_spend_limit_eur?: number;
          global_paused?: boolean;
          id?: boolean;
          monthly_spend_limit_eur?: number;
          paused_reason?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          daily_spend_limit_eur?: number;
          global_paused?: boolean;
          id?: boolean;
          monthly_spend_limit_eur?: number;
          paused_reason?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          granted_by: string | null;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          granted_by?: string | null;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          granted_by?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_any_role: {
        Args: { required: Database["public"]["Enums"]["app_role"][] };
        Returns: boolean;
      };
      has_role: { Args: { required: Database["public"]["Enums"]["app_role"] }; Returns: boolean };
      is_member: { Args: Record<PropertyKey, never>; Returns: boolean };
    };
    Enums: {
      app_role: "admin" | "editor" | "rights_reviewer" | "publisher" | "analyst" | "read_only";
      channel_mode: "draft" | "approval" | "autopublish" | "manual";
      credential_status: "pending" | "active" | "expired" | "revoked";
      job_run_status: "queued" | "running" | "succeeded" | "failed" | "blocked";
      platform: "youtube" | "instagram" | "tiktok" | "simulated";
      publication_status:
        "queued" | "in_progress" | "succeeded" | "failed" | "ambiguous" | "blocked";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "editor", "rights_reviewer", "publisher", "analyst", "read_only"],
      channel_mode: ["draft", "approval", "autopublish", "manual"],
      credential_status: ["pending", "active", "expired", "revoked"],
      job_run_status: ["queued", "running", "succeeded", "failed", "blocked"],
      platform: ["youtube", "instagram", "tiktok", "simulated"],
      publication_status: ["queued", "in_progress", "succeeded", "failed", "ambiguous", "blocked"],
    },
  },
} as const;
