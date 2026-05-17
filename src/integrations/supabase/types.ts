export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity: string | null
          id: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          id?: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          id?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      agent_service_pricing: {
        Row: {
          agent_id: string
          agent_price: number
          company_percentage: number
          company_price: number
          company_profit_value: number
          created_at: string
          id: string
          is_demo: boolean
          service_type: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          agent_price?: number
          company_percentage?: number
          company_price?: number
          company_profit_value?: number
          created_at?: string
          id?: string
          is_demo?: boolean
          service_type: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          agent_price?: number
          company_percentage?: number
          company_price?: number
          company_profit_value?: number
          created_at?: string
          id?: string
          is_demo?: boolean
          service_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      agents: {
        Row: {
          created_at: string
          governorate: string | null
          id: string
          is_demo: boolean
          name: string
          national_id: string | null
          phone: string | null
          status: string
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          governorate?: string | null
          id?: string
          is_demo?: boolean
          name: string
          national_id?: string | null
          phone?: string | null
          status?: string
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          governorate?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          national_id?: string | null
          phone?: string | null
          status?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json | null
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json | null
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json | null
        }
        Relationships: []
      }
      approvals: {
        Row: {
          agent_id: string | null
          agent_price: number
          airline: string | null
          authority: string | null
          company_percentage: number
          company_price: number
          company_profit_value: number
          company_value: number
          count: number
          created_at: string
          destination: string | null
          dob: string | null
          government_fee: number
          id: string
          is_demo: boolean
          issue_date: string | null
          issuing_company: string | null
          issuing_company_id: string | null
          national_id: string | null
          notes: string | null
          passenger_name: string
          passport: string | null
          price: number
          service_type: string
          status: string
          submit_date: string | null
          travel_date: string | null
          travel_statement: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_price?: number
          airline?: string | null
          authority?: string | null
          company_percentage?: number
          company_price?: number
          company_profit_value?: number
          company_value?: number
          count?: number
          created_at?: string
          destination?: string | null
          dob?: string | null
          government_fee?: number
          id?: string
          is_demo?: boolean
          issue_date?: string | null
          issuing_company?: string | null
          issuing_company_id?: string | null
          national_id?: string | null
          notes?: string | null
          passenger_name: string
          passport?: string | null
          price?: number
          service_type?: string
          status?: string
          submit_date?: string | null
          travel_date?: string | null
          travel_statement?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_price?: number
          airline?: string | null
          authority?: string | null
          company_percentage?: number
          company_price?: number
          company_profit_value?: number
          company_value?: number
          count?: number
          created_at?: string
          destination?: string | null
          dob?: string | null
          government_fee?: number
          id?: string
          is_demo?: boolean
          issue_date?: string | null
          issuing_company?: string | null
          issuing_company_id?: string | null
          national_id?: string | null
          notes?: string | null
          passenger_name?: string
          passport?: string | null
          price?: number
          service_type?: string
          status?: string
          submit_date?: string | null
          travel_date?: string | null
          travel_statement?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_logs: {
        Row: {
          backup_type: string
          created_at: string
          created_by: string | null
          failure_reason: string | null
          file_path: string | null
          file_size: number | null
          id: string
          restore_date: string | null
          restored_by: string | null
          status: string
        }
        Insert: {
          backup_type: string
          created_at?: string
          created_by?: string | null
          failure_reason?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          restore_date?: string | null
          restored_by?: string | null
          status?: string
        }
        Update: {
          backup_type?: string
          created_at?: string
          created_by?: string | null
          failure_reason?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          restore_date?: string | null
          restored_by?: string | null
          status?: string
        }
        Relationships: []
      }
      company_transactions: {
        Row: {
          arabic_tourism_cash_amount: number
          arabic_tourism_cash_net_amount: number
          cash_amount: number
          company_id: string
          count: number
          created_at: string
          date: string
          destination: string | null
          exchange_rate_used: number | null
          id: string
          instapay_amount: number
          is_demo: boolean
          merchant_cash_amount: number
          merchant_cash_net_amount: number
          merchant_cash_physical_amount: number
          merchant_id: string | null
          mobile_cash_amount: number
          mobile_cash_net_amount: number
          note: string | null
          payment_currency: string | null
          price: number
          service_type: string | null
          source_service_id: string | null
          source_service_type: string | null
          total_paid: number
          trip_value: number
          usd_amount: number
        }
        Insert: {
          arabic_tourism_cash_amount?: number
          arabic_tourism_cash_net_amount?: number
          cash_amount?: number
          company_id: string
          count?: number
          created_at?: string
          date?: string
          destination?: string | null
          exchange_rate_used?: number | null
          id?: string
          instapay_amount?: number
          is_demo?: boolean
          merchant_cash_amount?: number
          merchant_cash_net_amount?: number
          merchant_cash_physical_amount?: number
          merchant_id?: string | null
          mobile_cash_amount?: number
          mobile_cash_net_amount?: number
          note?: string | null
          payment_currency?: string | null
          price?: number
          service_type?: string | null
          source_service_id?: string | null
          source_service_type?: string | null
          total_paid?: number
          trip_value?: number
          usd_amount?: number
        }
        Update: {
          arabic_tourism_cash_amount?: number
          arabic_tourism_cash_net_amount?: number
          cash_amount?: number
          company_id?: string
          count?: number
          created_at?: string
          date?: string
          destination?: string | null
          exchange_rate_used?: number | null
          id?: string
          instapay_amount?: number
          is_demo?: boolean
          merchant_cash_amount?: number
          merchant_cash_net_amount?: number
          merchant_cash_physical_amount?: number
          merchant_id?: string | null
          mobile_cash_amount?: number
          mobile_cash_net_amount?: number
          note?: string | null
          payment_currency?: string | null
          price?: number
          service_type?: string | null
          source_service_id?: string | null
          source_service_type?: string | null
          total_paid?: number
          trip_value?: number
          usd_amount?: number
        }
        Relationships: []
      }
      expense_deductions: {
        Row: {
          amount: number
          created_at: string
          currency: string
          deduction_date: string
          exchange_rate: number | null
          expense_id: string
          funding_source: string | null
          id: string
          is_demo: boolean
          merchant_id: string | null
          status: string
          usd_amount: number
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          deduction_date?: string
          exchange_rate?: number | null
          expense_id: string
          funding_source?: string | null
          id?: string
          is_demo?: boolean
          merchant_id?: string | null
          status?: string
          usd_amount?: number
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          deduction_date?: string
          exchange_rate?: number | null
          expense_id?: string
          funding_source?: string | null
          id?: string
          is_demo?: boolean
          merchant_id?: string | null
          status?: string
          usd_amount?: number
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          auto_deduct_day: number | null
          auto_deduct_enabled: boolean
          created_at: string
          currency: string
          date: string
          exchange_rate: number | null
          expense_name: string
          expense_type: string
          funding_source: string | null
          id: string
          is_demo: boolean
          merchant_id: string | null
          notes: string | null
          payment_method: string
          usd_amount: number
        }
        Insert: {
          amount?: number
          auto_deduct_day?: number | null
          auto_deduct_enabled?: boolean
          created_at?: string
          currency?: string
          date?: string
          exchange_rate?: number | null
          expense_name: string
          expense_type?: string
          funding_source?: string | null
          id?: string
          is_demo?: boolean
          merchant_id?: string | null
          notes?: string | null
          payment_method?: string
          usd_amount?: number
        }
        Update: {
          amount?: number
          auto_deduct_day?: number | null
          auto_deduct_enabled?: boolean
          created_at?: string
          currency?: string
          date?: string
          exchange_rate?: number | null
          expense_name?: string
          expense_type?: string
          funding_source?: string | null
          id?: string
          is_demo?: boolean
          merchant_id?: string | null
          notes?: string | null
          payment_method?: string
          usd_amount?: number
        }
        Relationships: []
      }
      flights: {
        Row: {
          agent_id: string | null
          agent_price: number
          airline: string | null
          authority: string | null
          company_percentage: number
          company_price: number
          company_profit_value: number
          company_value: number
          count: number
          created_at: string
          destination: string | null
          dob: string | null
          id: string
          is_demo: boolean
          issuing_company: string | null
          national_id: string | null
          notes: string | null
          passenger_name: string
          passport: string | null
          price: number
          status: string
          travel_date: string | null
          travel_statement: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_price?: number
          airline?: string | null
          authority?: string | null
          company_percentage?: number
          company_price?: number
          company_profit_value?: number
          company_value?: number
          count?: number
          created_at?: string
          destination?: string | null
          dob?: string | null
          id?: string
          is_demo?: boolean
          issuing_company?: string | null
          national_id?: string | null
          notes?: string | null
          passenger_name: string
          passport?: string | null
          price?: number
          status?: string
          travel_date?: string | null
          travel_statement?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_price?: number
          airline?: string | null
          authority?: string | null
          company_percentage?: number
          company_price?: number
          company_profit_value?: number
          company_value?: number
          count?: number
          created_at?: string
          destination?: string | null
          dob?: string | null
          id?: string
          is_demo?: boolean
          issuing_company?: string | null
          national_id?: string | null
          notes?: string | null
          passenger_name?: string
          passport?: string | null
          price?: number
          status?: string
          travel_date?: string | null
          travel_statement?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flights_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      investor_transactions: {
        Row: {
          amount: number
          created_at: string
          date: string
          id: string
          investor_id: string
          is_demo: boolean
          note: string | null
          payment_method: string | null
          transaction_type: string
        }
        Insert: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          investor_id: string
          is_demo?: boolean
          note?: string | null
          payment_method?: string | null
          transaction_type: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          investor_id?: string
          is_demo?: boolean
          note?: string | null
          payment_method?: string | null
          transaction_type?: string
        }
        Relationships: []
      }
      investors: {
        Row: {
          created_at: string
          id: string
          investor_name: string
          is_demo: boolean
          phone: string | null
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          investor_name: string
          is_demo?: boolean
          phone?: string | null
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          investor_name?: string
          is_demo?: boolean
          phone?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      issuing_companies: {
        Row: {
          company_name: string
          created_at: string
          id: string
          is_demo: boolean
          phone: string | null
          service_type: string | null
          status: string
          whatsapp: string | null
        }
        Insert: {
          company_name: string
          created_at?: string
          id?: string
          is_demo?: boolean
          phone?: string | null
          service_type?: string | null
          status?: string
          whatsapp?: string | null
        }
        Update: {
          company_name?: string
          created_at?: string
          id?: string
          is_demo?: boolean
          phone?: string | null
          service_type?: string | null
          status?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      merchant_cash_collections: {
        Row: {
          amount: number
          created_at: string
          date: string
          id: string
          is_demo: boolean
          merchant_id: string
          note: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          is_demo?: boolean
          merchant_id: string
          note?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          is_demo?: boolean
          merchant_id?: string
          note?: string | null
        }
        Relationships: []
      }
      merchants: {
        Row: {
          created_at: string
          id: string
          is_demo: boolean
          merchant_name: string
          phone: string | null
          status: string
          supports_cash_wallet: boolean
          supports_instapay: boolean
          supports_physical_cash: boolean
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_demo?: boolean
          merchant_name: string
          phone?: string | null
          status?: string
          supports_cash_wallet?: boolean
          supports_instapay?: boolean
          supports_physical_cash?: boolean
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_demo?: boolean
          merchant_name?: string
          phone?: string | null
          status?: string
          supports_cash_wallet?: boolean
          supports_instapay?: boolean
          supports_physical_cash?: boolean
          whatsapp?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          agent_id: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          invite_accepted: boolean
          invited_by: string | null
          is_active: boolean
          permissions: Json
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          invite_accepted?: boolean
          invited_by?: string | null
          is_active?: boolean
          permissions?: Json
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          invite_accepted?: boolean
          invited_by?: string | null
          is_active?: boolean
          permissions?: Json
        }
        Relationships: []
      }
      system_dropdown_options: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean
          value: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          is_active?: boolean
          value: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          value?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          agent_id: string
          arabic_tourism_cash_amount: number
          arabic_tourism_cash_net_amount: number
          cash_amount: number
          count: number
          created_at: string
          date: string
          destination: string | null
          id: string
          instapay_amount: number
          is_demo: boolean
          merchant_cash_amount: number
          merchant_cash_net_amount: number
          merchant_cash_physical_amount: number
          merchant_id: string | null
          mobile_cash_amount: number
          mobile_cash_net_amount: number
          note: string | null
          paid: number
          payment_method: string
          price: number
          service_type: string | null
          source_service_id: string | null
          source_service_type: string | null
          total_paid: number
          travel_statement: string | null
        }
        Insert: {
          agent_id: string
          arabic_tourism_cash_amount?: number
          arabic_tourism_cash_net_amount?: number
          cash_amount?: number
          count?: number
          created_at?: string
          date?: string
          destination?: string | null
          id?: string
          instapay_amount?: number
          is_demo?: boolean
          merchant_cash_amount?: number
          merchant_cash_net_amount?: number
          merchant_cash_physical_amount?: number
          merchant_id?: string | null
          mobile_cash_amount?: number
          mobile_cash_net_amount?: number
          note?: string | null
          paid?: number
          payment_method?: string
          price?: number
          service_type?: string | null
          source_service_id?: string | null
          source_service_type?: string | null
          total_paid?: number
          travel_statement?: string | null
        }
        Update: {
          agent_id?: string
          arabic_tourism_cash_amount?: number
          arabic_tourism_cash_net_amount?: number
          cash_amount?: number
          count?: number
          created_at?: string
          date?: string
          destination?: string | null
          id?: string
          instapay_amount?: number
          is_demo?: boolean
          merchant_cash_amount?: number
          merchant_cash_net_amount?: number
          merchant_cash_physical_amount?: number
          merchant_id?: string | null
          mobile_cash_amount?: number
          mobile_cash_net_amount?: number
          note?: string | null
          paid?: number
          payment_method?: string
          price?: number
          service_type?: string | null
          source_service_id?: string | null
          source_service_type?: string | null
          total_paid?: number
          travel_statement?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      usd_treasury_transactions: {
        Row: {
          company_id: string | null
          created_at: string
          date: string
          egp_amount: number
          exchange_rate: number | null
          id: string
          is_demo: boolean
          merchant_id: string | null
          note: string | null
          source_type: string | null
          type: string
          usd_amount: number
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          date?: string
          egp_amount?: number
          exchange_rate?: number | null
          id?: string
          is_demo?: boolean
          merchant_id?: string | null
          note?: string | null
          source_type?: string | null
          type?: string
          usd_amount?: number
        }
        Update: {
          company_id?: string | null
          created_at?: string
          date?: string
          egp_amount?: number
          exchange_rate?: number | null
          id?: string
          is_demo?: boolean
          merchant_id?: string | null
          note?: string | null
          source_type?: string | null
          type?: string
          usd_amount?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      run_auto_expense_deductions: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "manager" | "user"
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
  public: {
    Enums: {
      app_role: ["admin", "manager", "user"],
    },
  },
} as const
