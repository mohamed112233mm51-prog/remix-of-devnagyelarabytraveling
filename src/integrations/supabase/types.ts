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
          opening_credit: number
          opening_date: string | null
          opening_debit: number
          opening_note: string | null
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
          opening_credit?: number
          opening_date?: string | null
          opening_debit?: number
          opening_note?: string | null
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
          opening_credit?: number
          opening_date?: string | null
          opening_debit?: number
          opening_note?: string | null
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
      backup_logs: {
        Row: {
          backup_name: string | null
          backup_type: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          failure_reason: string | null
          file_path: string | null
          file_size: number | null
          file_url: string | null
          id: string
          restore_date: string | null
          restored_by: string | null
          started_at: string | null
          status: string | null
          trigger_type: string
        }
        Insert: {
          backup_name?: string | null
          backup_type: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          failure_reason?: string | null
          file_path?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          restore_date?: string | null
          restored_by?: string | null
          started_at?: string | null
          status?: string | null
          trigger_type?: string
        }
        Update: {
          backup_name?: string | null
          backup_type?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          failure_reason?: string | null
          file_path?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          restore_date?: string | null
          restored_by?: string | null
          started_at?: string | null
          status?: string | null
          trigger_type?: string
        }
        Relationships: []
      }
      cash_boxes: {
        Row: {
          balance: number
          created_at: string
          currency: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          currency: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
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
      currency_supplier_transactions: {
        Row: {
          bought_amount: number
          bought_currency: string
          created_at: string
          created_by: string | null
          description: string | null
          exchange_rate: number | null
          id: string
          payment_splits: Json
          sold_amount: number
          sold_currency: string
          supplier_id: string
          tx_date: string
          tx_type: string
          updated_at: string
        }
        Insert: {
          bought_amount?: number
          bought_currency: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          exchange_rate?: number | null
          id?: string
          payment_splits?: Json
          sold_amount?: number
          sold_currency: string
          supplier_id: string
          tx_date?: string
          tx_type: string
          updated_at?: string
        }
        Update: {
          bought_amount?: number
          bought_currency?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          exchange_rate?: number | null
          id?: string
          payment_splits?: Json
          sold_amount?: number
          sold_currency?: string
          supplier_id?: string
          tx_date?: string
          tx_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "currency_supplier_transactions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "currency_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      currency_suppliers: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      executions: {
        Row: {
          agent_id: string | null
          airline: string | null
          approval_company_id: string | null
          approval_validity_enabled: boolean | null
          birth_place: string | null
          created_at: string
          departure_from: string | null
          destination: string | null
          dob: string | null
          id: string
          is_demo: boolean
          issue_date: string | null
          national_id: string | null
          notes: string | null
          operation_status: string
          passenger_name: string
          passenger_type: string | null
          passport: string | null
          services: Json
          status: string
          submission_id: string | null
          travel_date: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          airline?: string | null
          approval_company_id?: string | null
          approval_validity_enabled?: boolean | null
          birth_place?: string | null
          created_at?: string
          departure_from?: string | null
          destination?: string | null
          dob?: string | null
          id?: string
          is_demo?: boolean
          issue_date?: string | null
          national_id?: string | null
          notes?: string | null
          operation_status?: string
          passenger_name: string
          passenger_type?: string | null
          passport?: string | null
          services?: Json
          status?: string
          submission_id?: string | null
          travel_date?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          airline?: string | null
          approval_company_id?: string | null
          approval_validity_enabled?: boolean | null
          birth_place?: string | null
          created_at?: string
          departure_from?: string | null
          destination?: string | null
          dob?: string | null
          id?: string
          is_demo?: boolean
          issue_date?: string | null
          national_id?: string | null
          notes?: string | null
          operation_status?: string
          passenger_name?: string
          passenger_type?: string | null
          passport?: string | null
          services?: Json
          status?: string
          submission_id?: string | null
          travel_date?: string | null
          updated_at?: string
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
      import_batches: {
        Row: {
          created_at: string
          file_name: string | null
          id: string
          import_type: string
          inserted_ids: Json
          rows_inserted: number
          target_table: string
          undone_at: string | null
          user_email: string | null
        }
        Insert: {
          created_at?: string
          file_name?: string | null
          id?: string
          import_type: string
          inserted_ids?: Json
          rows_inserted?: number
          target_table: string
          undone_at?: string | null
          user_email?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string | null
          id?: string
          import_type?: string
          inserted_ids?: Json
          rows_inserted?: number
          target_table?: string
          undone_at?: string | null
          user_email?: string | null
        }
        Relationships: []
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
          opening_credit: number
          opening_date: string | null
          opening_debit: number
          opening_note: string | null
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
          opening_credit?: number
          opening_date?: string | null
          opening_debit?: number
          opening_note?: string | null
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
          opening_credit?: number
          opening_date?: string | null
          opening_debit?: number
          opening_note?: string | null
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
          expense_id: string | null
          id: string
          is_demo: boolean
          merchant_id: string
          note: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          date?: string
          expense_id?: string | null
          id?: string
          is_demo?: boolean
          merchant_id: string
          note?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          expense_id?: string | null
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
      payment_splits: {
        Row: {
          amount: number
          cash_box_id: string | null
          created_at: string
          currency: string
          egp_equivalent: number
          exchange_rate: number | null
          gross_amount: number
          id: string
          merchant_commission_amount: number
          merchant_commission_rate: number
          method: string
          net_amount: number
          transaction_id: string
        }
        Insert: {
          amount?: number
          cash_box_id?: string | null
          created_at?: string
          currency: string
          egp_equivalent?: number
          exchange_rate?: number | null
          gross_amount?: number
          id?: string
          merchant_commission_amount?: number
          merchant_commission_rate?: number
          method: string
          net_amount?: number
          transaction_id: string
        }
        Update: {
          amount?: number
          cash_box_id?: string | null
          created_at?: string
          currency?: string
          egp_equivalent?: number
          exchange_rate?: number | null
          gross_amount?: number
          id?: string
          merchant_commission_amount?: number
          merchant_commission_rate?: number
          method?: string
          net_amount?: number
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_splits_cash_box_id_fkey"
            columns: ["cash_box_id"]
            isOneToOne: false
            referencedRelation: "cash_boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_splits_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
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
          is_super_admin: boolean
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
          is_super_admin?: boolean
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
          is_super_admin?: boolean
          permissions?: Json
        }
        Relationships: []
      }
      submissions: {
        Row: {
          agent_id: string | null
          approval_authority: string | null
          approval_company_id: string | null
          approval_validity_enabled: boolean
          birth_place: string | null
          created_at: string
          departure_from: string | null
          dob: string | null
          executed_at: string | null
          execution_id: string | null
          id: string
          is_demo: boolean
          issue_date: string | null
          national_id: string | null
          notes: string | null
          operation_status: string
          passenger_name: string
          passenger_type: string | null
          passport: string | null
          services: string[]
          status: string
          submit_date: string | null
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          approval_authority?: string | null
          approval_company_id?: string | null
          approval_validity_enabled?: boolean
          birth_place?: string | null
          created_at?: string
          departure_from?: string | null
          dob?: string | null
          executed_at?: string | null
          execution_id?: string | null
          id?: string
          is_demo?: boolean
          issue_date?: string | null
          national_id?: string | null
          notes?: string | null
          operation_status?: string
          passenger_name: string
          passenger_type?: string | null
          passport?: string | null
          services?: string[]
          status?: string
          submit_date?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          approval_authority?: string | null
          approval_company_id?: string | null
          approval_validity_enabled?: boolean
          birth_place?: string | null
          created_at?: string
          departure_from?: string | null
          dob?: string | null
          executed_at?: string | null
          execution_id?: string | null
          id?: string
          is_demo?: boolean
          issue_date?: string | null
          national_id?: string | null
          notes?: string | null
          operation_status?: string
          passenger_name?: string
          passenger_type?: string | null
          passport?: string | null
          services?: string[]
          status?: string
          submit_date?: string | null
          updated_at?: string
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
          expense_id: string | null
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
          expense_id?: string | null
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
          expense_id?: string | null
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
