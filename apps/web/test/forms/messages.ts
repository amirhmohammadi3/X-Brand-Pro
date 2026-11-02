// Shared minimal messages for the form tests. Both locales include the
// validation + form namespaces the F1.4 components read.
export const en = {
  validation: {
    required: 'This field is required.',
    email: 'Enter a valid email address.',
    phone: 'Enter a valid phone number.',
    min: 'Must be at least {min} characters.',
    max: 'Must be at most {max} characters.',
    password: 'Password must be at least {min} characters and include letters and numbers.',
    username: 'Username must be {min}-{max} characters: letters, numbers, underscore.',
    match: 'The two values do not match.',
  },
  form: {
    required: '(required)',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    passwordStrength: {
      label: 'Password strength',
      '0': 'Very weak',
      '1': 'Weak',
      '2': 'Fair',
      '3': 'Good',
      '4': 'Strong',
    },
    characterCount: '{count} of {max} characters',
    otp: { label: 'Verification code', description: 'Enter the {length}-digit code.' },
    fileDropzone: {
      drop: 'Drag files here or click to browse',
      dropSingle: 'Drag a file here or click to browse',
      accepted: 'Accepted: {types}',
      tooLarge: '{name} is too large (max {max}).',
      remove: 'Remove {name}',
      preview: 'Preview of {name}',
    },
    copy: { copy: 'Copy', copied: 'Copied' },
    errorSummary: { title: 'Please fix the following:', link: 'Go to {label}' },
  },
  common: { save: 'Save' },
};

export const fa = {
  validation: {
    required: 'این فیلد الزامی است.',
    email: 'یک آدرس ایمیل معتبر وارد کنید.',
    phone: 'یک شماره تلفن معتبر وارد کنید.',
    min: 'حداقل {min} نویسه لازم است.',
    max: 'حداکثر {max} نویسه مجاز است.',
    password: 'رمز باید حداقل {min} نویسه و شامل حروف و عدد باشد.',
    username: 'نام کاربری باید {min} تا {max} نویسه از حروف، عدد یا زیرخط باشد.',
    match: 'دو مقدار با هم مطابقت ندارند.',
  },
  form: {
    required: '(الزامی)',
    showPassword: 'نمایش رمز',
    hidePassword: 'پنهان کردن رمز',
    passwordStrength: {
      label: 'قدرت رمز',
      '0': 'بسیار ضعیف',
      '1': 'ضعیف',
      '2': 'متوسط',
      '3': 'خوب',
      '4': 'قوی',
    },
    characterCount: '{count} از {max} نویسه',
    otp: { label: 'کد تأیید', description: 'کد {length} رقمی را وارد کنید.' },
    fileDropzone: {
      drop: 'فایل‌ها را اینجا بکشید یا برای انتخاب کلیک کنید',
      dropSingle: 'یک فایل را اینجا بکشید یا برای انتخاب کلیک کنید',
      accepted: 'مجاز: {types}',
      tooLarge: '{name} بیش از حد بزرگ است (حداکثر {max}).',
      remove: 'حذف {name}',
      preview: 'پیش‌نمایش {name}',
    },
    copy: { copy: 'کپی', copied: 'کپی شد' },
    errorSummary: { title: 'لطفاً موارد زیر را اصلاح کنید:', link: 'رفتن به {label}' },
  },
  common: { save: 'ذخیره' },
};
