import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Mail, Lock, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { projectId, publicAnonKey, cloudbaseApiBaseUrl, cloudbasePublishableKey, getCloudBaseRequestHeaders } from '../../../utils/supabase/info';
import { API_BASE_URL } from '../../utils/api-client';
import { storeSlugFromBusinessName } from '../../utils/storeSlug';
import { setVendorAuthSessionCookie } from '../utils/vendorAuthCookie';
import { toast } from 'sonner';
import { notifyMigooUserSessionChanged } from '../../constants';
import { createTencentCloudBaseCompatClient } from '../../utils/tencentCloudbaseClient';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { storeName } = useParams<{ storeName?: string }>();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<'email' | 'verify'>('email');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const isVendorRoute = location.pathname.startsWith('/vendor/');
  const storefrontBasePath = storeName
    ? `/vendor/${storeName}`
    : '/';
  const returnTo = searchParams.get('returnTo');
  const accountHint = (searchParams.get('account') || '').trim().toLowerCase();
  const isVendorAccount = accountHint === 'vendor';
  const goBackPath = returnTo || storefrontBasePath;
  const isAdminReturn = Boolean((returnTo || '').includes('/admin')) && !isVendorAccount;

  useEffect(() => {
    const prefillEmail = (searchParams.get('email') || '').trim();
    const requestedStep = searchParams.get('step');
    if (prefillEmail) {
      setEmail(prefillEmail);
    }
    if (prefillEmail && requestedStep === 'verify') {
      setStep('verify');
    }
  }, [searchParams]);

  const sendOtpRequest = async (targetEmail: string) => {
    try {
      const response = await fetch(
        `${cloudbaseApiBaseUrl}/auth/send-email-otp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getCloudBaseRequestHeaders(),

            ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
            'apikey': publicAnonKey,
          },
          body: JSON.stringify({
            email: targetEmail.trim(),
            ...(accountHint ? { accountHint } : {}),
          })
        }
      );

      const data = await response.json();

      if (!response.ok || data.emailSent === false) {
        const message = data.email_error || data.error || data.message || 'Failed to send OTP';
        setError(message);
        toast.error(message);
        if (data.needsSetup && isVendorAccount) {
          setTimeout(() => navigate('/vendor/setup'), 1200);
        }
        return false;
      }

      setError('');
      toast.success(data.message || 'Password reset code sent to your email!');
      return true;
    } catch (err: any) {
      console.error('Send OTP error:', err);
      const message = err?.message || 'Failed to send OTP. Please try again.';
      setError(message);
      toast.error(message);
      return false;
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const sent = await sendOtpRequest(email);
    setLoading(false);
    if (sent) {
      setStep('verify');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(
        `${cloudbaseApiBaseUrl}/auth/verify-otp-and-reset`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getCloudBaseRequestHeaders(),

            ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
            'apikey': publicAnonKey,
          },
          body: JSON.stringify({ 
            email: email.trim(), 
            otp: otpCode.trim(), 
            newPassword 
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to reset password');
        setLoading(false);
        toast.error(data.error || 'Failed to reset password');
        return;
      }

      // Auto-login after successful password reset
      const accountKind = String(data.accountKind || '').trim();
      const useStaffLogin = accountKind === 'staff' || (!accountKind && isAdminReturn);
      const useVendorLogin = accountKind === 'vendor' || isVendorAccount;

      try {
        if (useVendorLogin) {
          const loginResponse = await fetch(`${API_BASE_URL}/vendor-auth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getCloudBaseRequestHeaders(),
              ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
            },
            body: JSON.stringify({
              email: email.trim(),
              password: newPassword,
            }),
          });
          const loginData = await loginResponse.json();
          if (loginResponse.ok && loginData?.success && loginData?.vendor) {
            let storeSlug =
              loginData.vendor.storeSlug ||
              storeSlugFromBusinessName(loginData.vendor.storeName || loginData.vendor.name || '');
            const vendorData = {
              id: loginData.vendor.id,
              email: loginData.vendor.email,
              name: loginData.vendor.name,
              businessName: loginData.vendor.businessName,
              phone: loginData.vendor.phone,
              vendorId: loginData.vendor.id,
              storeName: loginData.vendor.storeName,
              storeSlug,
            };
            localStorage.setItem('vendorAuth', JSON.stringify(vendorData));
            setVendorAuthSessionCookie(vendorData, true);
            toast.success('Password reset successful! You are now signed in.');
          } else {
            toast.success('Password reset successful! Please sign in with your new password.');
          }
        } else if (useStaffLogin) {
          const client = createTencentCloudBaseCompatClient();
          const { data: loginData, error: loginError } = await client.auth.signInStaffWithPassword({
            email: email.trim(),
            password: newPassword,
          });
          if (!loginError && loginData.user) {
            toast.success('Password reset successful! You are now signed in.');
          } else {
            toast.success('Password reset successful! Please sign in with your new password.');
          }
        } else {
          const loginResponse = await fetch(
            `${cloudbaseApiBaseUrl}/auth/login`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...getCloudBaseRequestHeaders(),

                ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
                'apikey': publicAnonKey,
              },
              body: JSON.stringify({
                email: email.trim(),
                password: newPassword,
              }),
            }
          );

          const loginData = await loginResponse.json();
          if (loginResponse.ok && loginData?.user) {
            localStorage.setItem('migoo-user', JSON.stringify(loginData.user));
            notifyMigooUserSessionChanged();
            toast.success('Password reset successful! You are now signed in.');
          } else {
            toast.success('Password reset successful! Please sign in with your new password.');
          }
        }
      } catch (autoLoginError) {
        console.warn('Auto-login after reset failed:', autoLoginError);
        toast.success('Password reset successful! Please sign in with your new password.');
      }

      setLoading(false);
      setTimeout(() => {
        navigate(goBackPath);
      }, 800);
    } catch (err: any) {
      console.error('Verify OTP error:', err);
      setError('Failed to verify OTP. Please try again.');
      setLoading(false);
      toast.error('Failed to verify OTP. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        {/* STEP 1: Enter Email */}
        {step === 'email' && (
          <>
            <div className="mb-6">
              <button
                onClick={() => navigate(goBackPath)}
                className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors mb-4"
              >
                <ArrowLeft className="w-4 h-4" />
                {isVendorAccount || (returnTo || '').includes('/admin') ? 'Back to Login' : 'Back to Store'}
              </button>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">
                RESET PASSWORD
              </h1>
              <p className="text-sm text-slate-500">
                Enter your email to receive a reset code
              </p>
            </div>

            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <Label htmlFor="reset-email" className="text-sm font-medium text-slate-700 mb-1.5 block">
                  Email Address *
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <Input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    className="pl-10 h-12 bg-slate-50 border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-[#1a1d29] hover:bg-slate-900 text-white font-semibold rounded-full shadow-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send Reset Code'}
              </Button>
            </form>
          </>
        )}

        {/* STEP 2: Verify OTP and Set New Password */}
        {step === 'verify' && (
          <>
            <div className="mb-6">
              <button
                onClick={() => setStep('email')}
                className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors mb-4"
              >
                <ArrowLeft className="w-4 h-4" />
                Change Email
              </button>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">
                VERIFY CODE
              </h1>
              <p className="text-sm text-slate-500">
                Enter the 6-digit code sent to {email}
              </p>
            </div>

            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <Label htmlFor="otp" className="text-sm font-medium text-slate-700 mb-1.5 block">
                  Verification Code *
                </Label>
                <Input
                  id="otp"
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="Enter 6-digit code"
                  required
                  maxLength={6}
                  className="h-12 bg-slate-50 border-slate-200 rounded-lg text-center text-2xl tracking-widest"
                />
              </div>

              <div>
                <Label htmlFor="new-password" className="text-sm font-medium text-slate-700 mb-1.5 block">
                  New Password *
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <Input
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    required
                    className="pl-10 pr-10 h-12 bg-slate-50 border-slate-200 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                    aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                  >
                    {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-[#1a1d29] hover:bg-slate-900 text-white font-semibold rounded-full shadow-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'Resetting...' : 'Reset Password'}
              </Button>

              <button
                type="button"
                onClick={async () => {
                  setError('');
                  setLoading(true);
                  await sendOtpRequest(email);
                  setLoading(false);
                }}
                className="w-full text-sm text-slate-600 hover:text-slate-900 transition-colors"
              >
                Resend Code
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}