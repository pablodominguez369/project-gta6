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
      approvals: {
        Row: {
          created_at: string;
          decision: Database["public"]["Enums"]["approval_decision"];
          id: string;
          reason: string | null;
          reviewer_id: string;
          target_id: string;
          target_type: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          decision: Database["public"]["Enums"]["approval_decision"];
          id?: string;
          reason?: string | null;
          reviewer_id?: string;
          target_id: string;
          target_type: string;
        };
        Update: {
          created_at?: string;
          decision?: Database["public"]["Enums"]["approval_decision"];
          id?: string;
          reason?: string | null;
          reviewer_id?: string;
          target_id?: string;
          target_type?: string;
        };
        Relationships: [];
      };
      assets: {
        Row: {
          attribution: string;
          content_hash: string;
          created_at: string;
          created_by: string | null;
          id: string;
          kind: Database["public"]["Enums"]["asset_kind"];
          license_id: string | null;
          metadata: NonNullable<Json>;
          mime_type: string;
          origin: Database["public"]["Enums"]["asset_origin"];
          owner: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          rights_note: string;
          rights_status: Database["public"]["Enums"]["rights_status"];
          size_bytes: number;
          source_url: string | null;
          storage_path: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          attribution?: string;
          content_hash: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind: Database["public"]["Enums"]["asset_kind"];
          license_id?: string | null;
          metadata?: NonNullable<Json>;
          mime_type: string;
          origin: Database["public"]["Enums"]["asset_origin"];
          owner: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          rights_note?: string;
          rights_status?: Database["public"]["Enums"]["rights_status"];
          size_bytes: number;
          source_url?: string | null;
          storage_path: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          attribution?: string;
          content_hash?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["asset_kind"];
          license_id?: string | null;
          metadata?: NonNullable<Json>;
          mime_type?: string;
          origin?: Database["public"]["Enums"]["asset_origin"];
          owner?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          rights_note?: string;
          rights_status?: Database["public"]["Enums"]["rights_status"];
          size_bytes?: number;
          source_url?: string | null;
          storage_path?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assets_license_id_fkey";
            columns: ["license_id"];
            isOneToOne: false;
            referencedRelation: "licenses";
            referencedColumns: ["id"];
          },
        ];
      };
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
          live_uploads_enabled: boolean;
          live_uploads_reason: string | null;
          max_posts_per_day: number;
          min_minutes_between_posts: number;
          mode: Database["public"]["Enums"]["channel_mode"];
          paused: boolean;
          paused_reason: string | null;
          platform: Database["public"]["Enums"]["platform"];
          timezone: string;
          updated_at: string;
          upload_visibility: Database["public"]["Enums"]["upload_visibility"];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          display_name: string;
          id?: string;
          live_uploads_enabled?: boolean;
          live_uploads_reason?: string | null;
          max_posts_per_day?: number;
          min_minutes_between_posts?: number;
          mode?: Database["public"]["Enums"]["channel_mode"];
          paused?: boolean;
          paused_reason?: string | null;
          platform: Database["public"]["Enums"]["platform"];
          timezone?: string;
          updated_at?: string;
          upload_visibility?: Database["public"]["Enums"]["upload_visibility"];
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          display_name?: string;
          id?: string;
          live_uploads_enabled?: boolean;
          live_uploads_reason?: string | null;
          max_posts_per_day?: number;
          min_minutes_between_posts?: number;
          mode?: Database["public"]["Enums"]["channel_mode"];
          paused?: boolean;
          paused_reason?: string | null;
          platform?: Database["public"]["Enums"]["platform"];
          timezone?: string;
          updated_at?: string;
          upload_visibility?: Database["public"]["Enums"]["upload_visibility"];
        };
        Relationships: [];
      };
      claim_sources: {
        Row: {
          claim_id: string;
          created_at: string;
          quote_hint: string | null;
          source_id: string;
        };
        ComputedFields: never;
        Insert: {
          claim_id: string;
          created_at?: string;
          quote_hint?: string | null;
          source_id: string;
        };
        Update: {
          claim_id?: string;
          created_at?: string;
          quote_hint?: string | null;
          source_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "claim_sources_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "claims";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "claim_sources_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
        ];
      };
      claims: {
        Row: {
          certainty: Database["public"]["Enums"]["claim_certainty"];
          created_at: string;
          created_by: string | null;
          id: string;
          opportunity_id: string;
          sensitive: boolean;
          text: string;
          updated_at: string;
          verified_at: string | null;
          verified_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          certainty: Database["public"]["Enums"]["claim_certainty"];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          opportunity_id: string;
          sensitive?: boolean;
          text: string;
          updated_at?: string;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Update: {
          certainty?: Database["public"]["Enums"]["claim_certainty"];
          created_at?: string;
          created_by?: string | null;
          id?: string;
          opportunity_id?: string;
          sensitive?: boolean;
          text?: string;
          updated_at?: string;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "claims_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
        ];
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
      feed_sources: {
        Row: {
          consecutive_failures: number;
          created_at: string;
          created_by: string | null;
          enabled: boolean;
          id: string;
          kind: Database["public"]["Enums"]["feed_kind"];
          last_polled_at: string | null;
          poll_minutes: number;
          publisher: string;
          source_type: Database["public"]["Enums"]["source_type"];
          terms_checked_at: string | null;
          terms_url: string | null;
          trust_level: number;
          updated_at: string;
          url: string;
        };
        ComputedFields: never;
        Insert: {
          consecutive_failures?: number;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          kind: Database["public"]["Enums"]["feed_kind"];
          last_polled_at?: string | null;
          poll_minutes?: number;
          publisher: string;
          source_type: Database["public"]["Enums"]["source_type"];
          terms_checked_at?: string | null;
          terms_url?: string | null;
          trust_level?: number;
          updated_at?: string;
          url: string;
        };
        Update: {
          consecutive_failures?: number;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          kind?: Database["public"]["Enums"]["feed_kind"];
          last_polled_at?: string | null;
          poll_minutes?: number;
          publisher?: string;
          source_type?: Database["public"]["Enums"]["source_type"];
          terms_checked_at?: string | null;
          terms_url?: string | null;
          trust_level?: number;
          updated_at?: string;
          url?: string;
        };
        Relationships: [];
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
      licenses: {
        Row: {
          allowed_platforms: Database["public"]["Enums"]["platform"][];
          allowed_transformations: string;
          commercial_allowed: boolean;
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          licensor: string;
          notes: string;
          proof_path: string | null;
          scope: string;
          terms_url: string | null;
          territory: string;
          updated_at: string;
          valid_from: string | null;
        };
        ComputedFields: never;
        Insert: {
          allowed_platforms: Database["public"]["Enums"]["platform"][];
          allowed_transformations?: string;
          commercial_allowed?: boolean;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          licensor: string;
          notes?: string;
          proof_path?: string | null;
          scope: string;
          terms_url?: string | null;
          territory: string;
          updated_at?: string;
          valid_from?: string | null;
        };
        Update: {
          allowed_platforms?: Database["public"]["Enums"]["platform"][];
          allowed_transformations?: string;
          commercial_allowed?: boolean;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          licensor?: string;
          notes?: string;
          proof_path?: string | null;
          scope?: string;
          terms_url?: string | null;
          territory?: string;
          updated_at?: string;
          valid_from?: string | null;
        };
        Relationships: [];
      };
      llm_usage: {
        Row: {
          cost_eur: number;
          created_at: string;
          id: string;
          input_tokens: number;
          model: string;
          output_tokens: number;
          provider: string;
          purpose: string;
          request_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          cost_eur: number;
          created_at?: string;
          id?: string;
          input_tokens: number;
          model: string;
          output_tokens: number;
          provider: string;
          purpose: string;
          request_id?: string | null;
        };
        Update: {
          cost_eur?: number;
          created_at?: string;
          id?: string;
          input_tokens?: number;
          model?: string;
          output_tokens?: number;
          provider?: string;
          purpose?: string;
          request_id?: string | null;
        };
        Relationships: [];
      };
      media_project_scenes: {
        Row: {
          asset_id: string;
          project_id: string;
          scene_index: number;
        };
        ComputedFields: never;
        Insert: {
          asset_id: string;
          project_id: string;
          scene_index: number;
        };
        Update: {
          asset_id?: string;
          project_id?: string;
          scene_index?: number;
        };
        Relationships: [
          {
            foreignKeyName: "media_project_scenes_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "media_project_scenes_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "media_projects";
            referencedColumns: ["id"];
          },
        ];
      };
      media_projects: {
        Row: {
          attempts: number;
          brand: string;
          created_at: string;
          created_by: string | null;
          id: string;
          music_asset_id: string | null;
          next_attempt_at: string | null;
          script_id: string;
          status: Database["public"]["Enums"]["media_project_status"];
          status_reason: string | null;
          target_platforms: Database["public"]["Enums"]["platform"][];
          template: string;
          updated_at: string;
          voice_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          brand?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          music_asset_id?: string | null;
          next_attempt_at?: string | null;
          script_id: string;
          status?: Database["public"]["Enums"]["media_project_status"];
          status_reason?: string | null;
          target_platforms?: Database["public"]["Enums"]["platform"][];
          template?: string;
          updated_at?: string;
          voice_id?: string | null;
        };
        Update: {
          attempts?: number;
          brand?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          music_asset_id?: string | null;
          next_attempt_at?: string | null;
          script_id?: string;
          status?: Database["public"]["Enums"]["media_project_status"];
          status_reason?: string | null;
          target_platforms?: Database["public"]["Enums"]["platform"][];
          template?: string;
          updated_at?: string;
          voice_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "media_projects_music_asset_id_fkey";
            columns: ["music_asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "media_projects_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "media_projects_voice_id_fkey";
            columns: ["voice_id"];
            isOneToOne: false;
            referencedRelation: "voices";
            referencedColumns: ["id"];
          },
        ];
      };
      opportunities: {
        Row: {
          certainty: Database["public"]["Enums"]["claim_certainty"];
          created_at: string;
          decided_by: string | null;
          decision_reason: string | null;
          expires_at: string | null;
          id: string;
          risk_flags: string[];
          score: number;
          status: Database["public"]["Enums"]["opportunity_status"];
          summary: string;
          topic: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          certainty?: Database["public"]["Enums"]["claim_certainty"];
          created_at?: string;
          decided_by?: string | null;
          decision_reason?: string | null;
          expires_at?: string | null;
          id?: string;
          risk_flags?: string[];
          score?: number;
          status?: Database["public"]["Enums"]["opportunity_status"];
          summary?: string;
          topic: string;
          updated_at?: string;
        };
        Update: {
          certainty?: Database["public"]["Enums"]["claim_certainty"];
          created_at?: string;
          decided_by?: string | null;
          decision_reason?: string | null;
          expires_at?: string | null;
          id?: string;
          risk_flags?: string[];
          score?: number;
          status?: Database["public"]["Enums"]["opportunity_status"];
          summary?: string;
          topic?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      opportunity_sources: {
        Row: {
          created_at: string;
          opportunity_id: string;
          source_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          opportunity_id: string;
          source_id: string;
        };
        Update: {
          created_at?: string;
          opportunity_id?: string;
          source_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "opportunity_sources_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "opportunity_sources_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
        ];
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
          next_attempt_at: string | null;
          payload_json: NonNullable<Json>;
          permalink: string | null;
          platform_checkpoint: Json | null;
          published_at: string | null;
          reconcile_required: boolean;
          render_id: string | null;
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
          next_attempt_at?: string | null;
          payload_json?: NonNullable<Json>;
          permalink?: string | null;
          platform_checkpoint?: Json | null;
          published_at?: string | null;
          reconcile_required?: boolean;
          render_id?: string | null;
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
          next_attempt_at?: string | null;
          payload_json?: NonNullable<Json>;
          permalink?: string | null;
          platform_checkpoint?: Json | null;
          published_at?: string | null;
          reconcile_required?: boolean;
          render_id?: string | null;
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
          {
            foreignKeyName: "publications_render_id_fkey";
            columns: ["render_id"];
            isOneToOne: false;
            referencedRelation: "renders";
            referencedColumns: ["id"];
          },
        ];
      };
      renders: {
        Row: {
          audio_codec: string | null;
          checksum: string;
          created_at: string;
          disclosure_required: boolean;
          duration_ms: number;
          height: number;
          id: string;
          manifest: NonNullable<Json>;
          manifest_path: string;
          profile: string;
          project_id: string;
          qc_passed: boolean;
          qc_report: NonNullable<Json>;
          size_bytes: number;
          storage_path: string;
          version: number;
          video_codec: string;
          width: number;
        };
        ComputedFields: never;
        Insert: {
          audio_codec?: string | null;
          checksum: string;
          created_at?: string;
          disclosure_required: boolean;
          duration_ms: number;
          height: number;
          id?: string;
          manifest: NonNullable<Json>;
          manifest_path: string;
          profile: string;
          project_id: string;
          qc_passed: boolean;
          qc_report: NonNullable<Json>;
          size_bytes: number;
          storage_path: string;
          version: number;
          video_codec: string;
          width: number;
        };
        Update: {
          audio_codec?: string | null;
          checksum?: string;
          created_at?: string;
          disclosure_required?: boolean;
          duration_ms?: number;
          height?: number;
          id?: string;
          manifest?: NonNullable<Json>;
          manifest_path?: string;
          profile?: string;
          project_id?: string;
          qc_passed?: boolean;
          qc_report?: NonNullable<Json>;
          size_bytes?: number;
          storage_path?: string;
          version?: number;
          video_codec?: string;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: "renders_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "media_projects";
            referencedColumns: ["id"];
          },
        ];
      };
      schedule_rules: {
        Row: {
          approval_mode: string;
          cadence_policy: NonNullable<Json>;
          channel_id: string;
          created_at: string;
          created_by: string | null;
          enabled: boolean;
          id: string;
          timezone: string;
          updated_at: string;
          windows_json: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          approval_mode?: string;
          cadence_policy?: NonNullable<Json>;
          channel_id: string;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          timezone?: string;
          updated_at?: string;
          windows_json?: NonNullable<Json>;
        };
        Update: {
          approval_mode?: string;
          cadence_policy?: NonNullable<Json>;
          channel_id?: string;
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          timezone?: string;
          updated_at?: string;
          windows_json?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "schedule_rules_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: true;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      script_requests: {
        Row: {
          created_at: string;
          error_code: string | null;
          id: string;
          locale: string;
          next_attempt_at: string | null;
          opportunity_id: string;
          requested_by: string | null;
          script_id: string | null;
          status: Database["public"]["Enums"]["script_request_status"];
          target_duration_s: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          error_code?: string | null;
          id?: string;
          locale?: string;
          next_attempt_at?: string | null;
          opportunity_id: string;
          requested_by?: string | null;
          script_id?: string | null;
          status?: Database["public"]["Enums"]["script_request_status"];
          target_duration_s?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          error_code?: string | null;
          id?: string;
          locale?: string;
          next_attempt_at?: string | null;
          opportunity_id?: string;
          requested_by?: string | null;
          script_id?: string | null;
          status?: Database["public"]["Enums"]["script_request_status"];
          target_duration_s?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "script_requests_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "script_requests_script_id_fkey";
            columns: ["script_id"];
            isOneToOne: false;
            referencedRelation: "scripts";
            referencedColumns: ["id"];
          },
        ];
      };
      scripts: {
        Row: {
          created_at: string;
          created_by: string | null;
          cta: string | null;
          id: string;
          lines_json: NonNullable<Json>;
          llm_usage_id: string | null;
          locale: string;
          opportunity_id: string;
          prompt_version: string | null;
          qa_report: NonNullable<Json>;
          status: Database["public"]["Enums"]["script_status"];
          target_duration_s: number;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          cta?: string | null;
          id?: string;
          lines_json?: NonNullable<Json>;
          llm_usage_id?: string | null;
          locale?: string;
          opportunity_id: string;
          prompt_version?: string | null;
          qa_report?: NonNullable<Json>;
          status?: Database["public"]["Enums"]["script_status"];
          target_duration_s?: number;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          cta?: string | null;
          id?: string;
          lines_json?: NonNullable<Json>;
          llm_usage_id?: string | null;
          locale?: string;
          opportunity_id?: string;
          prompt_version?: string | null;
          qa_report?: NonNullable<Json>;
          status?: Database["public"]["Enums"]["script_status"];
          target_duration_s?: number;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "scripts_llm_usage_id_fkey";
            columns: ["llm_usage_id"];
            isOneToOne: false;
            referencedRelation: "llm_usage";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scripts_opportunity_id_fkey";
            columns: ["opportunity_id"];
            isOneToOne: false;
            referencedRelation: "opportunities";
            referencedColumns: ["id"];
          },
        ];
      };
      simulated_platform_posts: {
        Row: {
          created_at: string;
          external_id: string;
          id: string;
          idempotency_key: string;
          permalink: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          external_id: string;
          id?: string;
          idempotency_key: string;
          permalink?: string | null;
          status: string;
        };
        Update: {
          created_at?: string;
          external_id?: string;
          id?: string;
          idempotency_key?: string;
          permalink?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      sources: {
        Row: {
          added_by: string | null;
          canonical_url: string;
          content_hash: string | null;
          created_at: string;
          excerpt: string | null;
          feed_source_id: string | null;
          id: string;
          observed_at: string;
          published_at: string | null;
          publisher: string;
          source_type: Database["public"]["Enums"]["source_type"];
          title: string;
          trust_level: number;
          url: string;
        };
        ComputedFields: never;
        Insert: {
          added_by?: string | null;
          canonical_url: string;
          content_hash?: string | null;
          created_at?: string;
          excerpt?: string | null;
          feed_source_id?: string | null;
          id?: string;
          observed_at?: string;
          published_at?: string | null;
          publisher: string;
          source_type: Database["public"]["Enums"]["source_type"];
          title: string;
          trust_level?: number;
          url: string;
        };
        Update: {
          added_by?: string | null;
          canonical_url?: string;
          content_hash?: string | null;
          created_at?: string;
          excerpt?: string | null;
          feed_source_id?: string | null;
          id?: string;
          observed_at?: string;
          published_at?: string | null;
          publisher?: string;
          source_type?: Database["public"]["Enums"]["source_type"];
          title?: string;
          trust_level?: number;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sources_feed_source_id_fkey";
            columns: ["feed_source_id"];
            isOneToOne: false;
            referencedRelation: "feed_sources";
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
      voices: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          consent_proof_path: string | null;
          created_at: string;
          created_by: string | null;
          disclosure_note: string;
          disclosure_required: boolean;
          display_name: string;
          id: string;
          imitates_real_person: boolean;
          license_id: string | null;
          locale: string;
          provider: string;
          provider_voice_id: string;
          revoked_at: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          consent_proof_path?: string | null;
          created_at?: string;
          created_by?: string | null;
          disclosure_note?: string;
          disclosure_required?: boolean;
          display_name: string;
          id?: string;
          imitates_real_person?: boolean;
          license_id?: string | null;
          locale?: string;
          provider: string;
          provider_voice_id: string;
          revoked_at?: string | null;
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          consent_proof_path?: string | null;
          created_at?: string;
          created_by?: string | null;
          disclosure_note?: string;
          disclosure_required?: boolean;
          display_name?: string;
          id?: string;
          imitates_real_person?: boolean;
          license_id?: string | null;
          locale?: string;
          provider?: string;
          provider_voice_id?: string;
          revoked_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "voices_license_id_fkey";
            columns: ["license_id"];
            isOneToOne: false;
            referencedRelation: "licenses";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      complete_manual_publication: {
        Args: { permalink: string; publication_id: string };
        Returns: undefined;
      };
      create_claim: {
        Args: {
          p_certainty: Database["public"]["Enums"]["claim_certainty"];
          p_opportunity_id: string;
          p_sensitive: boolean;
          p_source_ids: string[];
          p_text: string;
        };
        Returns: string;
      };
      has_any_role: {
        Args: { required: Database["public"]["Enums"]["app_role"][] };
        Returns: boolean;
      };
      has_role: { Args: { required: Database["public"]["Enums"]["app_role"] }; Returns: boolean };
      is_member: { Args: Record<PropertyKey, never>; Returns: boolean };
      media_project_is_editable: { Args: { p_project_id: string }; Returns: boolean };
    };
    Enums: {
      app_role: "admin" | "editor" | "rights_reviewer" | "publisher" | "analyst" | "read_only";
      approval_decision: "approved" | "changes_requested" | "rejected";
      asset_kind: "image" | "video" | "audio" | "music" | "font" | "voice";
      asset_origin: "original_work" | "ai_generated" | "own_capture" | "official" | "licensed";
      channel_mode: "draft" | "approval" | "autopublish" | "manual";
      claim_certainty: "confirmed" | "reported" | "rumor" | "speculation" | "opinion";
      credential_status: "pending" | "active" | "expired" | "revoked";
      feed_kind: "rss" | "atom";
      job_run_status: "queued" | "running" | "succeeded" | "failed" | "blocked";
      media_project_status: "draft" | "queued" | "rendering" | "rendered" | "blocked" | "failed";
      opportunity_status: "new" | "shortlisted" | "accepted" | "discarded" | "expired";
      platform: "youtube" | "instagram" | "tiktok" | "simulated";
      publication_status:
        | "queued"
        | "in_progress"
        | "succeeded"
        | "failed"
        | "ambiguous"
        | "blocked"
        | "awaiting_manual";
      rights_status:
        | "original"
        | "cleared"
        | "requires_permission"
        | "unknown"
        | "restricted"
        | "expired"
        | "disputed";
      script_request_status: "queued" | "running" | "succeeded" | "blocked" | "failed";
      script_status: "draft" | "in_review" | "changes_requested" | "approved" | "rejected";
      source_type: "official" | "press" | "community" | "social";
      upload_visibility: "private" | "public";
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
      approval_decision: ["approved", "changes_requested", "rejected"],
      asset_kind: ["image", "video", "audio", "music", "font", "voice"],
      asset_origin: ["original_work", "ai_generated", "own_capture", "official", "licensed"],
      channel_mode: ["draft", "approval", "autopublish", "manual"],
      claim_certainty: ["confirmed", "reported", "rumor", "speculation", "opinion"],
      credential_status: ["pending", "active", "expired", "revoked"],
      feed_kind: ["rss", "atom"],
      job_run_status: ["queued", "running", "succeeded", "failed", "blocked"],
      media_project_status: ["draft", "queued", "rendering", "rendered", "blocked", "failed"],
      opportunity_status: ["new", "shortlisted", "accepted", "discarded", "expired"],
      platform: ["youtube", "instagram", "tiktok", "simulated"],
      publication_status: [
        "queued",
        "in_progress",
        "succeeded",
        "failed",
        "ambiguous",
        "blocked",
        "awaiting_manual",
      ],
      rights_status: [
        "original",
        "cleared",
        "requires_permission",
        "unknown",
        "restricted",
        "expired",
        "disputed",
      ],
      script_request_status: ["queued", "running", "succeeded", "blocked", "failed"],
      script_status: ["draft", "in_review", "changes_requested", "approved", "rejected"],
      source_type: ["official", "press", "community", "social"],
      upload_visibility: ["private", "public"],
    },
  },
} as const;
