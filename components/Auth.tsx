
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { 
  Heart, 
  Gavel, 
  User, 
  Mail, 
  Lock, 
  Loader2, 
  ArrowRight,
  WifiOff
} from 'lucide-react';

const Auth = ({ onLoginFallback }: { onLoginFallback?: (username: string) => void }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string, type: 'error' | 'success' } | null>(null);
  
  // Track mounted state to prevent state updates after unmount
  const isMounted = useRef(true);
  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  // Helper to save mapping locally for reliability in demos
  const saveUserMapping = (user: string, email: string) => {
    try {
        const map = JSON.parse(localStorage.getItem('app_user_map') || '{}');
        map[user] = email;
        localStorage.setItem('app_user_map', JSON.stringify(map));
    } catch (e) {}
  };

  const getEmailByUsername = (user: string) => {
    try {
        const map = JSON.parse(localStorage.getItem('app_user_map') || '{}');
        // Case-insensitive lookup for better UX
        const key = Object.keys(map).find(k => k.toLowerCase() === user.toLowerCase());
        return key ? map[key] : null;
    } catch (e) { return null; }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const trimmedLoginId = loginId.trim();
    const trimmedUsername = username.trim();

    try {
      if (isRegister) {
        if (!trimmedUsername) throw new Error("请输入用户名");
        if (!trimmedLoginId.includes('@')) throw new Error("注册需要有效的邮箱地址");
        
        const { data, error } = await supabase.auth.signUp({
          email: trimmedLoginId,
          password: password,
          options: {
            data: { username: trimmedUsername }
          }
        });
        
        if (error) {
           // Handle known Supabase error messages immediately
           if (error.message.includes("User already registered") || error.message.includes("unique")) {
              throw new Error("该邮箱已被注册！");
           }
           throw error;
        }

        // 客户端辅助逻辑
        if (data.user) {
            // Check for implicit duplicate (Supabase returns successful response with empty identities array if email exists)
            if (data.user.identities && data.user.identities.length === 0) {
                 throw new Error("该邮箱已被注册！");
            }
            
            // 1. Save to Local Storage (Immediate fix for current device)
            saveUserMapping(trimmedUsername, trimmedLoginId);

            // 2. Attempt to write to Profiles table (Fix for cross-device/cleared cache)
            // This ensures the "select" query in the Login block works.
            try {
                const { error: upsertError } = await supabase.from('profiles').upsert({
                    id: data.user.id,
                    username: trimmedUsername,
                    email: trimmedLoginId,
                    updated_at: new Date().toISOString()
                });
                if (upsertError) {
                     console.warn("Profile creation warning:", upsertError.message);
                }
            } catch (dbErr) {
                console.warn("Profile creation failed (Database might be missing 'profiles' table), falling back to local mapping.", dbErr);
            }

            // 3. Attempt Auto-Login (Bypass Email Verification Requirement if Backend Configured)
            if (!data.session) {
                // If no session returned, try to sign in immediately.
                const { error: signInError } = await supabase.auth.signInWithPassword({
                    email: trimmedLoginId,
                    password
                });
                
                if (signInError) {
                   throw signInError;
                }
            }
        }

        // If we reach here, we are logged in. App will unmount Auth.
        
      } else {
        // Login Logic
        let signInEmail = trimmedLoginId;
        const isEmail = trimmedLoginId.includes('@');
        
        if (!isEmail) {
            // Attempt username lookup
            // 1. Try Local Storage Mapping first (fastest and bypasses RLS issues for local users)
            let foundEmail = getEmailByUsername(trimmedLoginId);
            
            if (!foundEmail) {
                 // 2. Fallback to Supabase Lookup if not found locally
                 try {
                     const { data, error } = await supabase
                        .from('profiles')
                        .select('email')
                        .ilike('username', trimmedLoginId) // Case insensitive lookup
                        .maybeSingle();
                     
                     if (data?.email) {
                         foundEmail = data.email;
                         // Update local cache
                         saveUserMapping(trimmedLoginId, data.email);
                     }
                 } catch (err) {
                     // Ignore lookup error, will throw below
                 }
            }

            if (foundEmail) {
                signInEmail = foundEmail;
            } else {
                // throw new Error("用户名不存在或未配置 (请尝试使用邮箱登录)");
                // Allow "Offline Login" if we can't find email and later fetch fails
                signInEmail = trimmedLoginId; 
            }
        }

        const { error } = await supabase.auth.signInWithPassword({
          email: signInEmail,
          password
        });
        if (error) throw error;
      }
    } catch (err: any) {
      if (!isMounted.current) return;

      let errorMsg = err.message || "操作失败，请重试";
      const lowerMsg = errorMsg.toLowerCase();
      
      // Translate common Supabase errors
      if (lowerMsg.includes("invalid login credentials")) {
        errorMsg = "账号或密码错误";
      } else if (lowerMsg.includes("email not confirmed")) {
        errorMsg = "登录失败：系统开启了邮箱验证 (请检查邮箱或联系管理员关闭验证)";
      } else if (lowerMsg.includes("user already registered") || lowerMsg.includes("该邮箱已被注册")) {
        errorMsg = "该邮箱已被注册！";
      } else if (lowerMsg.includes("unique constraint")) {
        errorMsg = "用户名或邮箱已被使用";
      } else if (lowerMsg.includes("password should be at least")) {
        errorMsg = "密码长度至少为 6 位";
      } else if (lowerMsg.includes("rate limit")) {
        errorMsg = "操作过于频繁，请稍后再试";
      } else if (lowerMsg.includes("error sending confirmation mail")) {
        errorMsg = "发送验证邮件失败，请检查邮箱地址";
      } else if (lowerMsg.includes("failed to fetch")) {
        // Handle Offline / Bad Config
        if (onLoginFallback) {
             const fallbackUser = username || loginId.split('@')[0] || "User";
             setMessage({ text: "无法连接服务器，已为您开启离线模式...", type: 'success' });
             setTimeout(() => {
                 onLoginFallback(fallbackUser);
             }, 1000);
             return;
        } else {
             errorMsg = "无法连接服务器，且离线模式未启用。";
        }
      }

      setMessage({ text: errorMsg, type: 'error' });
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-rose-50 flex items-center justify-center p-6">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm">
        {/* App Logo */}
        <div className="relative w-24 h-24 mx-auto mb-6 group flex items-center justify-center">
            <div className="absolute inset-0 bg-rose-200 rounded-full animate-ping opacity-20 group-hover:opacity-40 transition-opacity"></div>
            <div className="absolute inset-0 flex items-center justify-center">
                <Heart className="text-rose-500 fill-rose-500 drop-shadow-lg" size={88} strokeWidth={1.5} />
            </div>
            <div className="absolute inset-0 flex items-center justify-center pt-1 pr-1 z-10">
                 <Gavel className="text-white drop-shadow-md transform -rotate-12" size={42} strokeWidth={2.5} />
            </div>
        </div>

        <div className="mb-6 text-center">
          <p className="text-xl font-black tracking-wide bg-gradient-to-br from-rose-400 via-red-500 to-pink-600 bg-clip-text text-transparent drop-shadow-sm font-cute">
            清官爱断家务事，AI 专理意难平
          </p>
        </div>
        
        <form onSubmit={handleAuth} className="space-y-4">
          {message && (
             <div className={`p-3 rounded-lg text-sm ${message.type === 'error' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-600 border border-green-100'}`}>
                {message.text}
             </div>
          )}

          {isRegister && (
            <div className="relative">
              <User className="absolute left-3 top-3 text-slate-400" size={18} />
              <input 
                type="text" 
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                className="w-full pl-10 p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-200 outline-none" 
                placeholder="用户名 (用于案件显示)" 
                required={isRegister}
              />
            </div>
          )}
          
          <div className="relative">
            {isRegister ? (
               <Mail className="absolute left-3 top-3 text-slate-400" size={18} />
            ) : (
               <User className="absolute left-3 top-3 text-slate-400" size={18} />
            )}
            <input 
              type={isRegister ? "email" : "text"}
              value={loginId} 
              onChange={e => setLoginId(e.target.value)} 
              className="w-full pl-10 p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-200 outline-none" 
              placeholder={isRegister ? "邮箱地址" : "邮箱地址 / 用户名"}
              required
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-3 text-slate-400" size={18} />
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="w-full pl-10 p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-rose-200 outline-none" 
              placeholder="密码 (至少6位)" 
              minLength={6}
              required
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-rose-600 text-white font-bold py-3 rounded-xl hover:bg-rose-700 transition-colors shadow-lg shadow-rose-200 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" /> : (isRegister ? '立即注册' : '登录')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={() => { setIsRegister(!isRegister); setMessage(null); setLoginId(""); setPassword(""); }}
            className="text-sm text-slate-500 hover:text-rose-600 flex items-center justify-center gap-1 mx-auto transition-colors"
          >
            {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
