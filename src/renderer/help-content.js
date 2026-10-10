'use strict';

/* ===================================================================
   MAZ-FATORA — contenu du Centre d'aide

   Source UNIQUE du contenu d'aide, en français (fr) et en arabe (ar).
   Chaque article est orienté tâche. Utilisé par l'application (help.js)
   et vérifié par les tests unitaires (test/unit/help.test.js).

   Aucune dépendance au DOM : utilisable côté navigateur (window.HELP)
   et côté Node (module.exports) pour les tests.

   Schéma d'un article :
     category : identifiant de catégorie (start | screen | tasks | faq | gloss)
     screen   : écran d'ancrage pour l'aide contextuelle (facultatif)
     priority : 1 = MVP, 2 = enrichissement
     title    : { fr, ar }
     goal     : { fr, ar }               (phrase d'objectif / réponse / définition)
     prereq   : { fr: [], ar: [] }        (facultatif)
     steps    : { fr: [], ar: [] }        (obligatoire hors faq/gloss)
     tips     : { fr: [], ar: [] }        (facultatif)
     errors   : { fr: [], ar: [] }        (facultatif)
     related  : []                        (identifiants d'articles)
   =================================================================== */

(function (root) {
  /* Écrans de l'application (ancrage de l'aide contextuelle). */
  const SCREENS = ['dashboard', 'import', 'transactions', 'drafts', 'invoices', 'quotes', 'payments', 'clients', 'rules', 'settings'];

  const CATEGORIES = [
    { id: 'start', title: { fr: 'Démarrage', ar: 'البدء' }, icon: 'i-dash' },
    { id: 'screen', title: { fr: 'Écrans de l’application', ar: 'شاشات التطبيق' }, icon: 'i-invoices' },
    { id: 'tasks', title: { fr: 'Tâches courantes', ar: 'المهام الشائعة' }, icon: 'i-check' },
    { id: 'faq', title: { fr: 'Questions fréquentes', ar: 'الأسئلة الشائعة' }, icon: 'i-alert' },
    { id: 'gloss', title: { fr: 'Glossaire', ar: 'المعجم' }, icon: 'i-file' }
  ];

  const articles = {
    /* ----------------------------- DÉMARRAGE ----------------------------- */
    'start.welcome': {
      category: 'start', priority: 1,
      title: { fr: 'Premier lancement : bien démarrer', ar: 'أول تشغيل: ابدأ بشكل صحيح' },
      goal: {
        fr: 'Découvrir en quelques minutes les étapes qui rendent l’application immédiatement utilisable.',
        ar: 'تعرّف في دقائق على الخطوات التي تجعل التطبيق جاهزًا للاستعمال.'
      },
      steps: {
        fr: [
          'Choisissez la langue (FR ou العربية) en bas de la barre latérale.',
          'Ouvrez « Paramètres » et renseignez votre société (nom, ICE, IF, RC, CNSS, TVA).',
          'Créez un premier client dans « Clients ».',
          'Établissez une première facture dans « Factures validées ».',
          'Une fois vos données saisies, faites une sauvegarde.'
        ],
        ar: [
          'اختر اللغة (FR أو العربية) أسفل الشريط الجانبي.',
          'افتح «الإعدادات» وعبّئ بيانات شركتك (الاسم، ICE، IF، RC، CNSS، TVA).',
          'أنشئ أول عميل في «العملاء».',
          'أنشئ أول فاتورة في «الفواتير المؤكدة».',
          'بعد إدخال بياناتك، أنشئ نسخة احتياطية.'
        ]
      },
      tips: {
        fr: ['Rien n’est définitif avant la validation de la première facture : vous pouvez revenir en arrière sans risque.'],
        ar: ['لا شيء نهائي قبل تأكيد أول فاتورة: يمكنك التراجع دون خطر.']
      },
      related: ['start.company', 'start.language', 'task.new-invoice', 'start.backup']
    },

    'start.company': {
      category: 'start', priority: 1,
      title: { fr: 'Configurer ma société et mes mentions légales', ar: 'إعداد الشركة والبيانات القانونية' },
      goal: {
        fr: 'Renseigner une seule fois l’identité de l’entreprise : elle figurera sur toutes vos factures et devis.',
        ar: 'إدخال هوية المؤسسة مرة واحدة: ستظهر على كل الفواتير وعروض الأسعار.'
      },
      steps: {
        fr: [
          'Ouvrez « Paramètres » → carte « Mon entreprise ».',
          'Saisissez le nom (et, si besoin, le nom en arabe).',
          'Renseignez les identifiants : ICE, IF, RC, Patente, CNSS, TVA.',
          'Ajoutez l’adresse, l’e-mail, le téléphone, le site web et le RIB / CCP.',
          'Choisissez un logo (PNG ou JPG), puis cliquez sur « Enregistrer les paramètres ».'
        ],
        ar: [
          'افتح «الإعدادات» ← بطاقة «مؤسستي».',
          'أدخل الاسم (وعند الحاجة الاسم بالعربية).',
          'عبّئ المعرّفات: ICE، IF، RC، Patente، CNSS، TVA.',
          'أضف العنوان والبريد والهاتف والموقع و RIB / CCP.',
          'اختر شعارًا (PNG أو JPG) ثم انقر «حفظ الإعدادات».'
        ]
      },
      tips: {
        fr: ['Les identifiants saisis apparaissent sur le document selon les cases cochées dans « Modèle des documents ».'],
        ar: ['تظهر المعرّفات المدخلة على الوثيقة حسب الخانات المحدّدة في «نموذج الوثائق».']
      },
      errors: {
        fr: ['Ne confondez pas le thème de l’application (clair/sombre) et le modèle du document (couleurs du PDF).'],
        ar: ['لا تخلط بين سمة التطبيق (فاتح/داكن) ونموذج الوثيقة (ألوان PDF).']
      },
      related: ['screen.settings', 'task.legal-ids', 'task.doc-model', 'faq.ice']
    },

    'start.language': {
      category: 'start', priority: 1,
      title: { fr: 'Changer la langue (français / arabe)', ar: 'تغيير اللغة (الفرنسية / العربية)' },
      goal: {
        fr: 'Travailler en français ou en arabe ; l’interface passe automatiquement en lecture de droite à gauche.',
        ar: 'العمل بالفرنسية أو العربية؛ تتحوّل الواجهة تلقائيًا إلى القراءة من اليمين إلى اليسار.'
      },
      steps: {
        fr: [
          'En bas de la barre latérale, cliquez sur « FR » ou « العربية ».',
          'L’interface et les nouveaux documents s’affichent dans la langue choisie.'
        ],
        ar: [
          'أسفل الشريط الجانبي، انقر « FR » أو « العربية ».',
          'تظهر الواجهة والوثائق الجديدة باللغة المختارة.'
        ]
      },
      tips: {
        fr: ['Les documents déjà générés conservent leur contenu ; l’aperçu suit la langue choisie pour le modèle bilingue.'],
        ar: ['تحتفظ الوثائق المنشأة سابقًا بمحتواها؛ وتتبع المعاينة اللغة المختارة للنموذج ثنائي اللغة.']
      },
      related: ['screen.settings', 'task.doc-model', 'faq.language']
    },

    'start.first-invoice': {
      category: 'start', priority: 1,
      title: { fr: 'Établir ma première facture de A à Z', ar: 'إنشاء أول فاتورة من الألف إلى الياء' },
      goal: {
        fr: 'Établir sa première facture, de la création jusqu’à l’impression.',
        ar: 'إنشاء أول فاتورة، من الإنشاء إلى الطباعة.'
      },
      steps: {
        fr: [
          'Créez d’abord le client dans « Clients ».',
          'Ouvrez « Factures validées » puis cliquez sur « Nouvelle facture ».',
          'Choisissez le client, puis ajoutez les lignes (désignation, quantité, prix, TVA).',
          'Vérifiez la date et l’échéance, puis cliquez sur « Enregistrer ».',
          'Cliquez sur « Aperçu » pour contrôler, puis « PDF » ou « Imprimer ».'
        ],
        ar: [
          'أنشئ أولًا العميل في «العملاء».',
          'افتح «الفواتير المؤكدة» ثم انقر «فاتورة جديدة».',
          'اختر العميل ثم أضف الأسطر (البيان، الكمية، السعر، الضريبة).',
          'تحقّق من التاريخ وتاريخ الاستحقاق ثم انقر «حفظ».',
          'انقر «معاينة» للمراجعة ثم «PDF» أو «طباعة».'
        ]
      },
      tips: {
        fr: ['Réutilisez les désignations par défaut du client pour aller plus vite.'],
        ar: ['أعد استخدام بيانات العميل الافتراضية للإسراع.']
      },
      errors: {
        fr: ['Le numéro définitif est attribué à l’enregistrement ; il ne peut plus être choisi librement.'],
        ar: ['يُمنح الرقم النهائي عند الحفظ؛ ولا يمكن اختياره بحرّية بعد ذلك.']
      },
      related: ['task.new-invoice', 'task.payment', 'task.doc-model', 'screen.invoices']
    },

    'start.backup': {
      category: 'start', priority: 1,
      title: { fr: 'Sauvegarder et restaurer mes données', ar: 'النسخ الاحتياطي والاستعادة' },
      goal: {
        fr: 'Mettre vos données à l’abri et savoir les restaurer.',
        ar: 'حماية بياناتك ومعرفة كيفية استعادتها.'
      },
      steps: {
        fr: [
          'Ouvrez « Paramètres » → carte « Sauvegarde & restauration ».',
          'Cliquez sur « Sauvegarder la base… » et choisissez l’emplacement du fichier.',
          'Pour restaurer, cliquez sur « Restaurer une sauvegarde… » et sélectionnez un fichier .json.'
        ],
        ar: [
          'افتح «الإعدادات» ← بطاقة «النسخ الاحتياطي والاستعادة».',
          'انقر «حفظ القاعدة…» واختر مكان الملف.',
          'للاستعادة، انقر «استعادة نسخة احتياطية…» واختر ملف .json.'
        ]
      },
      tips: {
        fr: ['Une sauvegarde automatique quotidienne est active ; conservez aussi une copie sur un support externe.'],
        ar: ['نسخة احتياطية يومية تلقائية مفعّلة؛ احفظ أيضًا نسخة على وسيط خارجي.']
      },
      related: ['screen.settings', 'faq.backup', 'faq.data-path']
    },

    /* ------------------------------- ÉCRANS ------------------------------- */
    'screen.dashboard': {
      category: 'screen', screen: 'dashboard', priority: 1,
      title: { fr: 'Le tableau de bord', ar: 'لوحة القيادة' },
      goal: {
        fr: 'Vue d’ensemble de votre activité : chiffres clés, échéances proches et dernières opérations.',
        ar: 'نظرة عامة على نشاطك: الأرقام الرئيسية، الاستحقاقات القريبة وآخر العمليات.'
      },
      steps: {
        fr: [
          'Choisissez le mois à analyser dans le sélecteur « Mois ».',
          'Lisez les indicateurs : chiffre d’affaires, encaissé, restant dû.',
          'Consultez les échéances proches pour relancer vos clients.',
          'Utilisez les raccourcis pour importer un relevé ou créer une facture.'
        ],
        ar: [
          'اختر الشهر المطلوب تحليله في محدّد «الشهر».',
          'اقرأ المؤشرات: رقم المعاملات، المحصّل، المتبقّي.',
          'راجع الاستحقاقات القريبة لتذكير عملائك.',
          'استعمل الاختصارات لاستيراد كشف أو إنشاء فاتورة.'
        ]
      },
      tips: {
        fr: ['Le tableau de bord se met à jour automatiquement après chaque validation ou encaissement.'],
        ar: ['تتحدّث لوحة القيادة تلقائيًا بعد كل تأكيد أو تحصيل.']
      },
      related: ['screen.invoices', 'screen.payments', 'task.import-bank']
    },

    'screen.import': {
      category: 'screen', screen: 'import', priority: 1,
      title: { fr: 'Importer un relevé bancaire', ar: 'استيراد كشف حساب بنكي' },
      goal: {
        fr: 'Charger un relevé bancaire (CSV, Excel ou PDF) et préparer les factures à valider.',
        ar: 'تحميل كشف حساب بنكي (CSV أو Excel أو PDF) وتجهيز الفواتير للتحقق.'
      },
      steps: {
        fr: [
          'Cliquez sur « Importer un relevé » et choisissez votre fichier.',
          'Vérifiez la période et le compte détectés.',
          'Contrôlez l’aperçu des mouvements reconnus.',
          'Renseignez les informations de facture (date, échéance) puis lancez la création.'
        ],
        ar: [
          'انقر «استيراد كشف حساب» واختر ملفك.',
          'تحقّق من الفترة والحساب المكتشفين.',
          'راجع معاينة الحركات المتعرَّف عليها.',
          'أدخل معلومات الفاتورة (التاريخ، الاستحقاق) ثم ابدأ الإنشاء.'
        ]
      },
      tips: {
        fr: ['Plus vos règles automatiques sont complètes, moins vous aurez de corrections à faire.'],
        ar: ['كلما كانت قواعدك التلقائية أكمل، قلّت التصحيحات المطلوبة.']
      },
      errors: {
        fr: ['Un relevé scanné de mauvaise qualité peut ne pas être reconnu : préférez un export CSV ou PDF d’origine.'],
        ar: ['قد لا يُتعرّف على كشف ممسوح ضعيف الجودة: يُفضّل تصدير CSV أو PDF أصلي.']
      },
      related: ['task.import-bank', 'screen.drafts', 'screen.rules', 'faq.import-fail']
    },

    'screen.transactions': {
      category: 'screen', screen: 'transactions', priority: 1,
      title: { fr: 'Les transactions', ar: 'المعاملات' },
      goal: {
        fr: 'Consulter et catégoriser tous les mouvements bancaires importés.',
        ar: 'عرض وتصنيف كل الحركات البنكية المستوردة.'
      },
      steps: {
        fr: [
          'Filtrez par période, sens (crédit/débit) ou statut.',
          'Ouvrez une ligne pour voir le détail.',
          'Rattachez (lettrez) un mouvement à une facture, ou marquez-le comme non traité.'
        ],
        ar: [
          'صفِّ حسب الفترة أو الاتجاه (دائن/مدين) أو الحالة.',
          'افتح سطرًا لعرض التفصيل.',
          'اربط (طابق) حركة بفاتورة أو اعتبرها غير معالجة.'
        ]
      },
      tips: {
        fr: ['Les mouvements déjà rattachés apparaissent comme « traités ».'],
        ar: ['تظهر الحركات المطابَقة كـ «معالجة».']
      },
      related: ['screen.import', 'screen.payments', 'gloss.lettrage']
    },

    'screen.drafts': {
      category: 'screen', screen: 'drafts', priority: 1,
      title: { fr: 'Les factures à valider', ar: 'الفواتير في انتظار التحقق' },
      goal: {
        fr: 'Confirmer, corriger ou ignorer les factures proposées à partir de l’import.',
        ar: 'تأكيد أو تصحيح أو تجاهل الفواتير المقترحة من الاستيراد.'
      },
      steps: {
        fr: [
          'Vérifiez pour chaque ligne le client, le montant et la date.',
          'Corrigez si nécessaire en ouvrant la facture.',
          'Cliquez sur « Valider » pour transformer la proposition en facture numérotée.',
          'Utilisez « Ignorer » pour écarter un faux positif.'
        ],
        ar: [
          'تحقّق لكل سطر من العميل والمبلغ والتاريخ.',
          'صحّح عند الحاجة بفتح الفاتورة.',
          'انقر «تأكيد» لتحويل الاقتراح إلى فاتورة مرقّمة.',
          'استعمل «تجاهل» لاستبعاد نتيجة خاطئة.'
        ]
      },
      tips: {
        fr: ['Une facture validée rejoint « Factures validées » et reçoit son numéro définitif.'],
        ar: ['الفاتورة المؤكدة تنتقل إلى «الفواتير المؤكدة» وتحصل على رقمها النهائي.']
      },
      related: ['screen.import', 'screen.invoices', 'task.new-invoice']
    },

    'screen.invoices': {
      category: 'screen', screen: 'invoices', priority: 1,
      title: { fr: 'Les factures validées', ar: 'الفواتير المؤكدة' },
      goal: {
        fr: 'Retrouver toutes vos factures confirmées, les imprimer et suivre les règlements.',
        ar: 'العثور على كل فواتيرك المؤكدة وطباعتها ومتابعة تحصيلها.'
      },
      steps: {
        fr: [
          'Utilisez les filtres (période, statut payé/impayé, client).',
          'Ouvrez une facture pour la modifier ou consulter son historique.',
          'Cliquez sur « Aperçu », « PDF » ou « Imprimer ».',
          'Enregistrez un règlement depuis la facture concernée.'
        ],
        ar: [
          'استعمل المرشّحات (الفترة، الحالة مدفوعة/غير مدفوعة، العميل).',
          'افتح فاتورة لتعديلها أو الاطلاع على سجلّها.',
          'انقر «معاينة» أو «PDF» أو «طباعة».',
          'سجّل دفعة من الفاتورة المعنية.'
        ]
      },
      tips: {
        fr: ['Une facture verrouillée (déjà comptabilisée) est en lecture seule.'],
        ar: ['الفاتورة المقفلة (المسجّلة محاسبيًا) للقراءة فقط.']
      },
      related: ['task.new-invoice', 'task.payment', 'task.doc-model', 'screen.payments']
    },

    'screen.quotes': {
      category: 'screen', screen: 'quotes', priority: 1,
      title: { fr: 'Les devis', ar: 'عروض الأسعار' },
      goal: {
        fr: 'Créer des devis, gérer leur validité et les convertir en factures.',
        ar: 'إنشاء عروض أسعار وإدارة صلاحيتها وتحويلها إلى فواتير.'
      },
      steps: {
        fr: [
          'Cliquez sur « Nouveau devis ».',
          'Choisissez le client et saisissez les lignes.',
          'Enregistrez : un numéro de devis et une date de validité sont attribués.',
          'Convertissez le devis en facture quand le client accepte.'
        ],
        ar: [
          'انقر «عرض سعر جديد».',
          'اختر العميل وأدخل الأسطر.',
          'احفظ: يُمنح رقم عرض وتاريخ صلاحية.',
          'حوّل العرض إلى فاتورة عند قبول العميل.'
        ]
      },
      tips: {
        fr: ['Un devis converti indique la facture correspondante.'],
        ar: ['يشير عرض السعر المحوّل إلى الفاتورة المقابلة.']
      },
      related: ['task.new-quote', 'task.quote-to-invoice', 'screen.invoices']
    },

    'screen.payments': {
      category: 'screen', screen: 'payments', priority: 1,
      title: { fr: 'Les paiements', ar: 'المدفوعات' },
      goal: {
        fr: 'Enregistrer les encaissements et faire le lien avec les factures (lettrage).',
        ar: 'تسجيل التحصيلات وربطها بالفواتير (المطابقة).'
      },
      steps: {
        fr: [
          'Cliquez sur « Nouveau paiement ».',
          'Sélectionnez la facture (ou le client), le montant, la date et le mode.',
          'Enregistrez : le reste dû de la facture est mis à jour.',
          'Consultez la liste pour suivre les encaissements.'
        ],
        ar: [
          'انقر «دفعة جديدة».',
          'اختر الفاتورة (أو العميل) والمبلغ والتاريخ والطريقة.',
          'احفظ: يُحدَّث المتبقّي على الفاتورة.',
          'راجع القائمة لمتابعة التحصيلات.'
        ]
      },
      tips: {
        fr: ['Un paiement partiel laisse la facture « partiellement payée ».'],
        ar: ['الدفعة الجزئية تُبقي الفاتورة «مدفوعة جزئيًا».']
      },
      related: ['task.payment', 'screen.invoices', 'gloss.lettrage']
    },

    'screen.clients': {
      category: 'screen', screen: 'clients', priority: 1,
      title: { fr: 'Les clients', ar: 'العملاء' },
      goal: {
        fr: 'Gérer le fichier clients et leurs informations de facturation.',
        ar: 'إدارة ملف العملاء ومعلومات فوترتهم.'
      },
      steps: {
        fr: [
          'Cliquez sur « Nouveau client ».',
          'Renseignez nom, identifiants, adresse et coordonnées.',
          'Définissez la désignation par défaut utilisée sur les factures.',
          'Enregistrez.'
        ],
        ar: [
          'انقر «عميل جديد».',
          'أدخل الاسم والمعرّفات والعنوان وبيانات الاتصال.',
          'حدّد البيان الافتراضي المستعمل في الفواتير.',
          'احفظ.'
        ]
      },
      tips: {
        fr: ['Les informations du client apparaissent dans le bloc client du document.'],
        ar: ['تظهر معلومات العميل في بطاقة العميل بالوثيقة.']
      },
      related: ['screen.invoices', 'screen.settings', 'task.new-invoice']
    },

    'screen.rules': {
      category: 'screen', screen: 'rules', priority: 1,
      title: { fr: 'Les règles automatiques', ar: 'القواعد التلقائية' },
      goal: {
        fr: 'Créer des règles pour reconnaître automatiquement les clients à partir du libellé bancaire.',
        ar: 'إنشاء قواعد للتعرّف تلقائيًا على العملاء من بيان الحركة البنكية.'
      },
      steps: {
        fr: [
          'Cliquez sur « Nouvelle règle ».',
          'Indiquez le texte à rechercher (ex. nom du client dans le libellé).',
          'Associez le client et, si besoin, la désignation par défaut.',
          'Enregistrez : la règle s’appliquera aux prochains imports.'
        ],
        ar: [
          'انقر «قاعدة جديدة».',
          'أدخل النص المطلوب البحث عنه (مثل اسم العميل في البيان).',
          'اربط العميل، وعند الحاجة البيان الافتراضي.',
          'احفظ: ستُطبَّق القاعدة على الاستيرادات القادمة.'
        ]
      },
      tips: {
        fr: ['Testez une règle en important un petit relevé.'],
        ar: ['اختبر القاعدة باستيراد كشف صغير.']
      },
      related: ['screen.import', 'task.rules', 'screen.clients']
    },

    'screen.settings': {
      category: 'screen', screen: 'settings', priority: 1,
      title: { fr: 'Les paramètres', ar: 'الإعدادات' },
      goal: {
        fr: 'Configurer l’entreprise, la facturation, le modèle des documents, la sauvegarde et la sécurité.',
        ar: 'إعداد المؤسسة والفوترة ونموذج الوثائق والنسخ الاحتياطي والأمان.'
      },
      steps: {
        fr: [
          '« Mon entreprise » : identité et mentions légales.',
          '« Facturation » : TVA, délai, préfixes, numérotation, apparence.',
          '« Modèle des documents » : présentation des PDF (voir l’article dédié).',
          '« Sauvegarde & restauration » : protéger vos données.',
          '« Sécurité » : activer un mot de passe.'
        ],
        ar: [
          '«مؤسستي»: الهوية والبيانات القانونية.',
          '«الفوترة»: الضريبة، الأجل، البادئات، الترقيم، المظهر.',
          '«نموذج الوثائق»: شكل ملفات PDF (انظر المقال المخصّص).',
          '«النسخ الاحتياطي والاستعادة»: حماية بياناتك.',
          '«الأمان»: تفعيل كلمة سر.'
        ]
      },
      tips: {
        fr: ['Les réglages du modèle de documents s’enregistrent immédiatement.'],
        ar: ['تُحفظ إعدادات نموذج الوثائق فورًا.']
      },
      related: ['task.doc-model', 'start.company', 'start.backup', 'task.lock']
    },

    /* ------------------------------- TÂCHES ------------------------------- */
    'task.new-invoice': {
      category: 'tasks', screen: 'invoices', priority: 1,
      title: { fr: 'Créer une facture', ar: 'إنشاء فاتورة' },
      goal: {
        fr: 'Établir et valider une facture pour un client.',
        ar: 'إعداد فاتورة لعميل وتأكيدها.'
      },
      prereq: {
        fr: ['Avoir configuré la société.', 'Avoir créé le client (ou le créer à la volée).'],
        ar: ['إعداد الشركة.', 'إنشاء العميل (أو إنشاؤه أثناء العملية).']
      },
      steps: {
        fr: [
          'Ouvrez « Factures validées » et cliquez sur « Nouvelle facture ».',
          'Choisissez le client, puis ajoutez les lignes : désignation, quantité, prix unitaire, TVA.',
          'Vérifiez la date, l’échéance et le mode de règlement.',
          'Cliquez sur « Enregistrer » : la facture reçoit son numéro définitif.',
          'Cliquez sur « Aperçu » pour contrôler, puis « PDF » ou « Imprimer ».'
        ],
        ar: [
          'افتح «الفواتير المؤكدة» وانقر «فاتورة جديدة».',
          'اختر العميل ثم أضف الأسطر: البيان، الكمية، سعر الوحدة، الضريبة.',
          'تحقّق من التاريخ وتاريخ الاستحقاق وطريقة الدفع.',
          'انقر «حفظ»: تحصل الفاتورة على رقمها النهائي.',
          'انقر «معاينة» للمراجعة ثم «PDF» أو «طباعة».'
        ]
      },
      tips: {
        fr: ['Réutilisez les désignations par défaut du client pour aller plus vite.', 'Le brouillon n’occupe pas de numéro définitif.'],
        ar: ['أعد استخدام بيانات العميل الافتراضية للإسراع.', 'المسودة لا تستهلك رقمًا نهائيًا.']
      },
      errors: {
        fr: ['La numérotation est figée dès la première facture validée.', 'Vérifiez le taux de TVA avant d’enregistrer.'],
        ar: ['الترقيم يُثبّت منذ أول فاتورة مؤكدة.', 'تحقّق من نسبة الضريبة قبل الحفظ.']
      },
      related: ['screen.invoices', 'task.payment', 'task.doc-model', 'gloss.tva']
    },

    'task.new-quote': {
      category: 'tasks', screen: 'quotes', priority: 1,
      title: { fr: 'Créer un devis', ar: 'إنشاء عرض سعر' },
      goal: {
        fr: 'Créer un devis destiné à un client.',
        ar: 'إنشاء عرض سعر موجّه لعميل.'
      },
      steps: {
        fr: [
          'Ouvrez « Devis » puis cliquez sur « Nouveau devis ».',
          'Choisissez le client et saisissez les lignes.',
          'Vérifiez la durée de validité (en jours).',
          'Enregistrez : le devis reçoit un numéro.'
        ],
        ar: [
          'افتح «عروض الأسعار» وانقر «عرض سعر جديد».',
          'اختر العميل وأدخل الأسطر.',
          'تحقّق من مدة الصلاحية (بالأيام).',
          'احفظ: يُمنح العرض رقمًا.'
        ]
      },
      tips: {
        fr: ['La validité est réglable dans « Paramètres → Facturation ».'],
        ar: ['يمكن ضبط الصلاحية في «الإعدادات ← الفوترة».']
      },
      related: ['screen.quotes', 'task.quote-to-invoice', 'task.doc-model']
    },

    'task.quote-to-invoice': {
      category: 'tasks', screen: 'quotes', priority: 1,
      title: { fr: 'Convertir un devis en facture', ar: 'تحويل عرض سعر إلى فاتورة' },
      goal: {
        fr: 'Transformer un devis accepté en facture.',
        ar: 'تحويل عرض سعر مقبول إلى فاتورة.'
      },
      steps: {
        fr: [
          'Ouvrez le devis dans « Devis ».',
          'Cliquez sur « Convertir en facture ».',
          'Vérifiez la date et l’échéance, puis validez.',
          'La facture est créée ; le devis indique la facture correspondante.'
        ],
        ar: [
          'افتح عرض السعر في «عروض الأسعار».',
          'انقر «تحويل إلى فاتورة».',
          'تحقّق من التاريخ والاستحقاق ثم أكّد.',
          'تُنشأ الفاتورة، ويشير العرض إلى الفاتورة المقابلة.'
        ]
      },
      tips: {
        fr: ['Le contenu du devis (lignes, client) est repris automatiquement.'],
        ar: ['يُستنسخ محتوى العرض (الأسطر والعميل) تلقائيًا.']
      },
      related: ['screen.quotes', 'task.new-quote', 'screen.invoices']
    },

    'task.payment': {
      category: 'tasks', screen: 'payments', priority: 1,
      title: { fr: 'Enregistrer un paiement', ar: 'تسجيل دفعة' },
      goal: {
        fr: 'Enregistrer un encaissement et mettre à jour le reste dû.',
        ar: 'تسجيل دفعة وتحديث المتبقّي.'
      },
      steps: {
        fr: [
          'Ouvrez « Paiements » puis « Nouveau paiement ».',
          'Sélectionnez la facture (ou le client).',
          'Saisissez le montant, la date et le mode de règlement.',
          'Enregistrez.'
        ],
        ar: [
          'افتح «المدفوعات» ثم «دفعة جديدة».',
          'اختر الفاتورة (أو العميل).',
          'أدخل المبلغ والتاريخ وطريقة الدفع.',
          'احفظ.'
        ]
      },
      tips: {
        fr: ['Un règlement partiel met la facture en « partiellement payée ».'],
        ar: ['الدفعة الجزئية تجعل الفاتورة «مدفوعة جزئيًا».']
      },
      errors: {
        fr: ['Le montant ne doit pas dépasser le reste dû.'],
        ar: ['يجب ألا يتجاوز المبلغ المتبقّي.']
      },
      related: ['screen.payments', 'screen.invoices', 'gloss.lettrage']
    },

    'task.doc-model': {
      category: 'tasks', screen: 'settings', priority: 1,
      title: { fr: 'Personnaliser le modèle des documents (PDF)', ar: 'تخصيص نموذج الوثائق (PDF)' },
      goal: {
        fr: 'Personnaliser l’apparence des PDF : modèle, couleurs, format, informations et textes.',
        ar: 'تخصيص مظهر ملفات PDF: النموذج، الألوان، الحجم، المعلومات والنصوص.'
      },
      steps: {
        fr: [
          'Ouvrez « Paramètres → Modèle des documents ».',
          'Choisissez un modèle (Classique, Moderne, Minimaliste, Élégant, Compact).',
          'Sélectionnez une couleur d’accent (ou une couleur personnalisée).',
          'Réglez le format (A4/A5), les marges, la densité, la police et les langues affichées.',
          'Cochez les informations à afficher, ajoutez vos textes, puis vérifiez avec « Aperçu ».'
        ],
        ar: [
          'افتح «الإعدادات ← نموذج الوثائق».',
          'اختر نموذجًا (كلاسيكي، عصري، بسيط، أنيق، مضغوط).',
          'اختر لونًا مميزًا (أو لونًا مخصّصًا).',
          'اضبط الحجم (A4/A5) والهوامش والكثافة والخط واللغات المعروضة.',
          'حدّد المعلومات المعروضة وأضف نصوصك ثم راجع عبر «معاينة».'
        ]
      },
      tips: {
        fr: ['Les modifications sont enregistrées immédiatement.', 'Le modèle « Classique » reproduit le rendu d’origine.'],
        ar: ['تُحفظ التعديلات فورًا.', 'نموذج «كلاسيكي» يستعيد الشكل الأصلي.']
      },
      errors: {
        fr: ['Ne confondez pas le thème de l’application et le modèle du document.'],
        ar: ['لا تخلط بين سمة التطبيق ونموذج الوثيقة.']
      },
      related: ['screen.settings', 'task.legal-ids', 'faq.pdf', 'task.reset-doc']
    },

    'task.legal-ids': {
      category: 'tasks', screen: 'settings', priority: 1,
      title: { fr: 'Choisir les identifiants légaux affichés', ar: 'اختيار المعرّفات القانونية المعروضة' },
      goal: {
        fr: 'Choisir précisément les identifiants légaux affichés sur les documents.',
        ar: 'اختيار بدقة المعرّفات القانونية المعروضة على الوثائق.'
      },
      steps: {
        fr: [
          'Ouvrez « Paramètres → Modèle des documents → Informations affichées ».',
          'Cochez ou décochez ICE, IF, RC, Patente, CNSS, TVA.',
          'Lisez l’avertissement affiché si un identifiant renseigné est masqué.'
        ],
        ar: [
          'افتح «الإعدادات ← نموذج الوثائق ← المعلومات المعروضة».',
          'حدّد أو ألغِ تحديد ICE، IF، RC، Patente، CNSS، TVA.',
          'اقرأ التنبيه المعروض إذا كانت معرّفات معبّأة مخفية.'
        ]
      },
      tips: {
        fr: ['Un identifiant masqué n’apparaît ni dans l’en-tête ni dans le pied.'],
        ar: ['المعرّف المخفي لا يظهر في الترويسة ولا في التذييل.']
      },
      errors: {
        fr: ['Masquer une mention obligatoire peut rendre la facture non conforme.'],
        ar: ['إخفاء بيان إلزامي قد يجعل الفاتورة غير مطابقة.']
      },
      related: ['start.company', 'task.doc-model', 'faq.ice', 'screen.settings']
    },

    'task.import-bank': {
      category: 'tasks', screen: 'import', priority: 1,
      title: { fr: 'Importer et rapprocher un relevé', ar: 'استيراد كشف حساب ومطابقته' },
      goal: {
        fr: 'Importer un relevé bancaire et rapprocher les mouvements des factures.',
        ar: 'استيراد كشف بنكي ومطابقة الحركات مع الفواتير.'
      },
      steps: {
        fr: [
          'Préparez un fichier CSV, Excel ou PDF de votre relevé.',
          'Ouvrez « Import relevé bancaire » et chargez le fichier.',
          'Vérifiez la période et l’aperçu des mouvements.',
          'Complétez les informations de facture puis lancez la création.',
          'Retrouvez les propositions dans « Factures à valider ».'
        ],
        ar: [
          'جهّز ملف CSV أو Excel أو PDF لكشفك.',
          'افتح «استيراد كشف حساب» وحمّل الملف.',
          'تحقّق من الفترة ومعاينة الحركات.',
          'أكمل معلومات الفاتورة ثم ابدأ الإنشاء.',
          'ستجد المقترحات في «الفواتير في انتظار التحقق».'
        ]
      },
      tips: {
        fr: ['Créez des règles automatiques pour éviter les corrections manuelles.'],
        ar: ['أنشئ قواعد تلقائية لتجنّب التصحيحات اليدوية.']
      },
      errors: {
        fr: ['Un montant au débit n’est pas un encaissement : seuls les crédits génèrent des factures.'],
        ar: ['المبلغ المدين ليس تحصيلًا: الدائن فقط يولّد الفواتير.']
      },
      related: ['screen.import', 'screen.drafts', 'screen.rules', 'faq.import-fail']
    },

    'task.amount-words': {
      category: 'tasks', screen: 'settings', priority: 2,
      title: { fr: 'Afficher le montant en toutes lettres', ar: 'عرض المبلغ كتابةً بالحروف' },
      goal: {
        fr: 'Afficher le montant en toutes lettres (français et/ou arabe) sur les documents.',
        ar: 'عرض المبلغ كتابةً بالحروف (بالفرنسية و/أو العربية) على الوثائق.'
      },
      steps: {
        fr: [
          'Ouvrez « Paramètres → Modèle des documents → Montant en toutes lettres ».',
          'Choisissez : bilingue, français seul, arabe seul ou aucun.'
        ],
        ar: [
          'افتح «الإعدادات ← نموذج الوثائق ← المبلغ كتابةً».',
          'اختر: ثنائي اللغة، الفرنسية فقط، العربية فقط أو بدون.'
        ]
      },
      tips: {
        fr: ['Utile pour éviter les litiges sur les gros montants.'],
        ar: ['مفيد لتفادي النزاعات في المبالغ الكبيرة.']
      },
      related: ['task.doc-model', 'faq.pdf']
    },

    'task.rules': {
      category: 'tasks', screen: 'rules', priority: 2,
      title: { fr: 'Automatiser la détection (règles)', ar: 'أتمتة الكشف (القواعد)' },
      goal: {
        fr: 'Automatiser la reconnaissance des clients et des désignations à l’import.',
        ar: 'أتمتة التعرّف على العملاء والبيانات عند الاستيراد.'
      },
      steps: {
        fr: [
          'Ouvrez « Règles automatiques » → « Nouvelle règle ».',
          'Saisissez le motif texte à rechercher.',
          'Associez le client et la désignation par défaut.',
          'Enregistrez.'
        ],
        ar: [
          'افتح «القواعد التلقائية» ← «قاعدة جديدة».',
          'أدخل النص المطلوب البحث عنه.',
          'اربط العميل والبيان الافتراضي.',
          'احفظ.'
        ]
      },
      tips: {
        fr: ['Les règles accélèrent le traitement des relevés récurrents.'],
        ar: ['تُسرّع القواعد معالجة الكشوف المتكرّرة.']
      },
      related: ['screen.rules', 'screen.import', 'task.import-bank']
    },

    'task.accounting-pack': {
      category: 'tasks', screen: 'settings', priority: 2,
      title: { fr: 'Générer le paquet comptable / clôture', ar: 'إنشاء الحزمة المحاسبية وإغلاق الفترة' },
      goal: {
        fr: 'Générer un paquet comptable (.zip) pour la clôture d’une période.',
        ar: 'إنشاء حزمة محاسبية (.zip) لإغلاق فترة.'
      },
      steps: {
        fr: [
          'Ouvrez « Paramètres → Export comptable — clôture de période ».',
          'Choisissez la période (du … au …).',
          'Générez le paquet et enregistrez le fichier .zip.'
        ],
        ar: [
          'افتح «الإعدادات ← التصدير المحاسبي — إغلاق الفترة».',
          'اختر الفترة (من … إلى …).',
          'أنشئ الحزمة واحفظ ملف .zip.'
        ]
      },
      tips: {
        fr: ['Le paquet contient journal, TVA par taux, encaissements, balance âgée et PDF des factures.'],
        ar: ['تضمّ الحزمة اليومية، الضريبة حسب النسبة، التحصيلات، الميزانية العمرية و PDF الفواتير.']
      },
      related: ['screen.settings', 'faq.backup', 'task.import-bank']
    },

    'task.lock': {
      category: 'tasks', screen: 'settings', priority: 2,
      title: { fr: 'Verrouiller l’application', ar: 'قفل التطبيق' },
      goal: {
        fr: 'Protéger l’accès à l’application par un mot de passe.',
        ar: 'حماية الوصول إلى التطبيق بكلمة سر.'
      },
      steps: {
        fr: [
          'Ouvrez « Paramètres → Sécurité ».',
          'Cliquez sur « Activer la protection… » et définissez un mot de passe.',
          'Pour verrouiller à tout moment, utilisez le bouton « Verrouiller ».'
        ],
        ar: [
          'افتح «الإعدادات ← الأمان».',
          'انقر «تفعيل الحماية…» وعيّن كلمة سر.',
          'للقفل في أي وقت، استعمل زر «قفل».'
        ]
      },
      tips: {
        fr: ['La version est monoposte : la protection vaut pour ce poste.'],
        ar: ['النسخة أحادية المحطة: الحماية خاصة بهذا الجهاز.']
      },
      related: ['screen.settings', 'faq.lock']
    },

    'task.reset-doc': {
      category: 'tasks', screen: 'settings', priority: 2,
      title: { fr: 'Revenir au modèle d’origine', ar: 'استعادة النموذج الأصلي' },
      goal: {
        fr: 'Revenir au modèle d’origine si une personnalisation ne convient pas.',
        ar: 'استعادة النموذج الأصلي إذا لم تناسبك إحدى التخصيصات.'
      },
      steps: {
        fr: [
          'Ouvrez « Paramètres → Modèle des documents ».',
          'Cliquez sur « Réinitialiser le modèle ».',
          'Confirmez : le rendu classique est rétabli.'
        ],
        ar: [
          'افتح «الإعدادات ← نموذج الوثائق».',
          'انقر «إعادة تعيين النموذج».',
          'أكّد: يُستعاد الشكل الكلاسيكي.'
        ]
      },
      related: ['task.doc-model']
    },

    /* --------------------------------- FAQ --------------------------------- */
    'faq.backup': {
      category: 'faq', priority: 1,
      title: { fr: 'Où sont stockées mes données ? Comment les sauvegarder ?', ar: 'أين تُخزَّن بياناتي؟ كيف أنشئ نسخة احتياطية؟' },
      goal: {
        fr: 'Vos données sont stockées localement, dans le dossier de données de l’application. Pour les protéger, ouvrez « Paramètres → Sauvegarde & restauration » et cliquez sur « Sauvegarder la base… ». Une sauvegarde automatique quotidienne est également active.',
        ar: 'بياناتك مخزّنة محليًا في مجلد بيانات التطبيق. لحمايتها افتح «الإعدادات ← النسخ الاحتياطي والاستعادة» وانقر «حفظ القاعدة…». كما تُفعّل نسخة احتياطية يومية تلقائية.'
      },
      related: ['start.backup', 'screen.settings', 'faq.data-path']
    },

    'faq.numbering': {
      category: 'faq', priority: 1,
      title: { fr: 'Pourquoi je ne peux plus changer le début de numérotation ?', ar: 'لماذا لم أعد أستطيع تغيير بداية الترقيم؟' },
      goal: {
        fr: 'Le début de numérotation ne peut plus être modifié dès qu’une facture a été validée : c’est une exigence de continuité. Pour repartir de zéro, il faudrait effacer toutes les factures.',
        ar: 'لا يمكن تغيير بداية الترقيم بعد تأكيد أي فاتورة: ذلك شرط لضمان التسلسل. للبدء من جديد يجب حذف جميع الفواتير.'
      },
      related: ['screen.settings', 'faq.data-path', 'task.new-invoice']
    },

    'faq.arabic': {
      category: 'faq', priority: 1,
      title: { fr: 'Comment obtenir des PDF bilingues FR/AR ?', ar: 'كيف أحصل على ملفات PDF ثنائية اللغة (فرنسي/عربي)؟' },
      goal: {
        fr: 'Dans « Paramètres → Modèle des documents », réglez « Langues affichées » sur « Bilingue (français + arabe) ». Le document affiche alors les libellés dans les deux langues, l’arabe en lecture de droite à gauche.',
        ar: 'في «الإعدادات ← نموذج الوثائق» اضبط «اللغات المعروضة» على «ثنائي اللغة (فرنسي + عربي)». حينها يعرض المستند التسميات باللغتين، والعربية من اليمين إلى اليسار.'
      },
      related: ['start.language', 'task.doc-model', 'faq.pdf']
    },

    'faq.import-fail': {
      category: 'faq', priority: 1,
      title: { fr: 'Mon relevé n’est pas reconnu, que faire ?', ar: 'لم يُتعرّف على كشفي، ماذا أفعل؟' },
      goal: {
        fr: 'Vérifiez que le fichier provient bien de la banque (CSV/Excel/PDF d’origine). Pour un PDF, évitez les scans. Vous pouvez aussi créer les factures manuellement.',
        ar: 'تحقّق من أن الملف صادر فعلًا عن البنك (CSV/Excel/PDF أصلي). بالنسبة لـ PDF تجنّب النسخ الممسوحة. يمكنك أيضًا إنشاء الفواتير يدويًا.'
      },
      related: ['task.import-bank', 'screen.import', 'faq.support']
    },

    'faq.tva': {
      category: 'faq', priority: 1,
      title: { fr: 'Quels taux de TVA sont disponibles ?', ar: 'ما نسب الضريبة المتوفّرة؟' },
      goal: {
        fr: 'Les taux marocains usuels sont proposés (0, 7, 10, 14, 20 %). Le taux par défaut se règle dans « Paramètres → Facturation ».',
        ar: 'تُقترح النسب المغربية المعتادة (0، 7، 10، 14، 20٪). تُضبط النسبة الافتراضية في «الإعدادات ← الفوترة».'
      },
      related: ['screen.settings', 'gloss.tva', 'task.new-invoice']
    },

    'faq.ice': {
      category: 'faq', priority: 1,
      title: { fr: 'Qu’est-ce que l’ICE, l’IF, la CNSS ? Doivent-ils figurer ?', ar: 'ما هي ICE و IF و CNSS؟ وهل يجب أن تظهر؟' },
      goal: {
        fr: 'L’ICE (Identifiant Commun de l’Entreprise), l’IF (Identifiant Fiscal) et la CNSS figurent parmi les mentions légales attendues sur une facture au Maroc. Renseignez-les dans « Paramètres → Mon entreprise ».',
        ar: 'ICE (المعرّف المشترك للمقاولة) و IF (المعرّف الجبائي) و CNSS من البيانات القانونية المتوقّعة على الفاتورة بالمغرب. عبّئها في «الإعدادات ← مؤسستي».'
      },
      related: ['start.company', 'task.legal-ids', 'gloss.ice']
    },

    'faq.pdf': {
      category: 'faq', priority: 1,
      title: { fr: 'Comment personnaliser l’apparence de mes factures ?', ar: 'كيف أخصّص مظهر فواتيري؟' },
      goal: {
        fr: 'Tout se règle dans « Paramètres → Modèle des documents » : modèle, couleurs, format, informations affichées et textes libres. Les modifications sont enregistrées immédiatement.',
        ar: 'كل شيء يُضبط في «الإعدادات ← نموذج الوثائق»: النموذج، الألوان، الحجم، المعلومات والنصوص. تُحفظ التعديلات فورًا.'
      },
      related: ['task.doc-model', 'task.legal-ids', 'faq.arabic']
    },

    'faq.lock': {
      category: 'faq', priority: 1,
      title: { fr: 'J’ai oublié le mot de passe, que faire ?', ar: 'نسيت كلمة السر، ماذا أفعل؟' },
      goal: {
        fr: 'La protection est monoposte. En cas d’oubli du mot de passe, utilisez l’option de réinitialisation proposée sur l’écran de verrouillage, ou contactez le support.',
        ar: 'الحماية أحادية المحطة. في حال نسيان كلمة السر استعمل خيار إعادة التعيين على شاشة القفل، أو اتصل بالدعم.'
      },
      related: ['task.lock', 'screen.settings', 'faq.support']
    },

    'faq.update': {
      category: 'faq', priority: 1,
      title: { fr: 'Comment mettre à jour l’application ?', ar: 'كيف أُحدّث التطبيق؟' },
      goal: {
        fr: 'Ouvrez « Paramètres » et cliquez sur « Vérifier les mises à jour… ». Si une version est disponible, cliquez sur « Installer et redémarrer ».',
        ar: 'افتح «الإعدادات» وانقر «التحقق من التحديثات…». إن توفّرت نسخة، انقر «تثبيت وإعادة التشغيل».'
      },
      related: ['screen.settings', 'faq.support']
    },

    'faq.windows': {
      category: 'faq', priority: 1,
      title: { fr: 'Fonctionne-t-elle sur Windows et macOS ?', ar: 'هل يعمل على Windows و macOS؟' },
      goal: {
        fr: 'Oui. L’application fonctionne sur macOS et Windows.',
        ar: 'نعم. يعمل التطبيق على macOS و Windows.'
      },
      related: ['faq.update', 'faq.data-path']
    },

    'faq.data-path': {
      category: 'faq', priority: 1,
      title: { fr: 'Où trouver le dossier de données ?', ar: 'أين أجد مجلد البيانات؟' },
      goal: {
        fr: 'Le dossier de données est affiché dans « Paramètres → Sauvegarde & restauration → Emplacement de la base de données ». Le bouton « Ouvrir le dossier » l’ouvre directement.',
        ar: 'يُعرض مجلد البيانات في «الإعدادات ← النسخ الاحتياطي والاستعادة ← موقع القاعدة». وزر «فتح المجلد» يفتحه مباشرة.'
      },
      related: ['faq.backup', 'screen.settings']
    },

    'faq.print': {
      category: 'faq', priority: 1,
      title: { fr: 'Différence entre Aperçu, Imprimer et PDF ?', ar: 'الفرق بين معاينة وطباعة و PDF؟' },
      goal: {
        fr: '« Aperçu » affiche le document à l’écran. « PDF » enregistre un fichier. « Imprimer » envoie à l’imprimante. Le contenu est identique.',
        ar: '«معاينة» تعرض الوثيقة على الشاشة. «PDF» تحفظ ملفًا. «طباعة» ترسل إلى الطابعة. المحتوى نفسه.'
      },
      related: ['screen.invoices', 'task.doc-model']
    },

    'faq.dark': {
      category: 'faq', priority: 1,
      title: { fr: 'Puis-je passer en thème sombre ?', ar: 'هل يمكنني التبديل إلى السمة الداكنة؟' },
      goal: {
        fr: 'Oui. Utilisez le bouton lune/soleil en bas de la barre latérale, ou « Paramètres → Facturation → Apparence ».',
        ar: 'نعم. استعمل زر القمر/الشمس أسفل الشريط الجانبي، أو «الإعدادات ← الفوترة ← المظهر».'
      },
      related: ['screen.settings']
    },

    'faq.language': {
      category: 'faq', priority: 1,
      title: { fr: 'Comment passer en arabe ?', ar: 'كيف أتحوّل إلى العربية؟' },
      goal: {
        fr: 'Cliquez sur « FR » ou « العربية » en bas de la barre latérale : l’interface change immédiatement.',
        ar: 'انقر « FR » أو « العربية » أسفل الشريط الجانبي: تتغيّر الواجهة فورًا.'
      },
      related: ['start.language', 'faq.arabic']
    },

    'faq.support': {
      category: 'faq', priority: 1,
      title: { fr: 'Comment contacter le support ou signaler un bug ?', ar: 'كيف أتواصل مع الدعم أو أُبلّغ عن خطأ؟' },
      goal: {
        fr: 'Consultez d’abord cet article et la FAQ. En cas de bug, notez la version affichée en bas de la barre latérale et décrivez les étapes qui ont conduit au problème.',
        ar: 'راجع أولًا هذا المقال والأسئلة الشائعة. في حال وجود خطأ، دوّن الإصدار الظاهر أسفل الشريط الجانبي واذكر الخطوات المؤدّية إلى المشكلة.'
      },
      related: ['faq.data-path', 'screen.dashboard']
    },

    /* ------------------------------ GLOSSAIRE ------------------------------ */
    'gloss.ice': {
      category: 'gloss', priority: 1,
      title: { fr: 'ICE', ar: 'ICE' },
      goal: {
        fr: 'Identifiant Commun de l’Entreprise : numéro unique d’identification des entreprises au Maroc.',
        ar: 'المعرّف المشترك للمقاولة: رقم تعريفي وحيد للمقاولات بالمغرب.'
      },
      related: ['gloss.if', 'start.company', 'faq.ice']
    },
    'gloss.if': {
      category: 'gloss', priority: 1,
      title: { fr: 'IF', ar: 'IF' },
      goal: {
        fr: 'Identifiant Fiscal attribué par l’administration fiscale.',
        ar: 'المعرّف الجبائي الممنوح من الإدارة الضريبية.'
      },
      related: ['gloss.ice', 'start.company']
    },
    'gloss.rc': {
      category: 'gloss', priority: 1,
      title: { fr: 'RC', ar: 'RC' },
      goal: {
        fr: 'Registre du Commerce : immatriculation commerciale de l’entreprise.',
        ar: 'السجل التجاري: التسجيل التجاري للمؤسسة.'
      },
      related: ['gloss.ice', 'start.company']
    },
    'gloss.patente': {
      category: 'gloss', priority: 1,
      title: { fr: 'Patente', ar: 'Patente' },
      goal: {
        fr: 'Taxe professionnelle communale, identifiée par un numéro.',
        ar: 'الضريبة المهنية الجماعية، تُعرَّف برقم.'
      },
      related: ['start.company', 'task.legal-ids']
    },
    'gloss.cnss': {
      category: 'gloss', priority: 1,
      title: { fr: 'CNSS', ar: 'CNSS' },
      goal: {
        fr: 'Caisse Nationale de Sécurité Sociale : numéro d’affiliation de l’employeur.',
        ar: 'الصندوق الوطني للضمان الاجتماعي: رقم انخراط المشغّل.'
      },
      related: ['start.company', 'task.legal-ids']
    },
    'gloss.tva': {
      category: 'gloss', priority: 1,
      title: { fr: 'TVA', ar: 'الضريبة على القيمة المضافة' },
      goal: {
        fr: 'Taxe sur la Valeur Ajoutée, calculée sur le montant hors taxes.',
        ar: 'الضريبة على القيمة المضافة، تُحتسب على المبلغ بدون ضريبة.'
      },
      related: ['gloss.ht', 'gloss.ttc', 'faq.tva']
    },
    'gloss.ht': {
      category: 'gloss', priority: 1,
      title: { fr: 'HT', ar: 'بدون ضريبة' },
      goal: {
        fr: 'Hors Taxes : montant avant ajout de la TVA.',
        ar: 'بدون ضريبة: المبلغ قبل إضافة الضريبة.'
      },
      related: ['gloss.ttc', 'gloss.tva']
    },
    'gloss.ttc': {
      category: 'gloss', priority: 1,
      title: { fr: 'TTC', ar: 'مع الضريبة' },
      goal: {
        fr: 'Toutes Taxes Comprises : montant final incluant la TVA.',
        ar: 'مع الضريبة: المبلغ النهائي شاملًا الضريبة.'
      },
      related: ['gloss.ht', 'gloss.tva']
    },
    'gloss.due-date': {
      category: 'gloss', priority: 1,
      title: { fr: 'Échéance', ar: 'تاريخ الاستحقاق' },
      goal: {
        fr: 'Date limite à laquelle le client doit payer la facture.',
        ar: 'آخر أجل يجب أن يدفع فيه العميل الفاتورة.'
      },
      related: ['task.payment', 'screen.invoices']
    },
    'gloss.lettrage': {
      category: 'gloss', priority: 1,
      title: { fr: 'Lettrage', ar: 'المطابقة' },
      goal: {
        fr: 'Action de rattacher un encaissement à une facture précise.',
        ar: 'ربط دفعة بفاتورة محدّدة.'
      },
      related: ['screen.payments', 'screen.transactions']
    },
    'gloss.avoir': {
      category: 'gloss', priority: 1,
      title: { fr: 'Avoir', ar: 'إشعار دائن' },
      goal: {
        fr: 'Note de crédit qui annule ou réduit une facture (fonction à venir).',
        ar: 'إشعار دائن يلغي فاتورة أو يخفّضها (خاصية قادمة).'
      },
      related: ['screen.invoices']
    },
    'gloss.quote': {
      category: 'gloss', priority: 1,
      title: { fr: 'Devis', ar: 'عرض سعر' },
      goal: {
        fr: 'Proposition chiffrée avant facturation ; peut être convertie en facture.',
        ar: 'اقتراح مُسعّر قبل الفوترة؛ يمكن تحويله إلى فاتورة.'
      },
      related: ['screen.quotes', 'task.quote-to-invoice']
    },
    'gloss.draft': {
      category: 'gloss', priority: 1,
      title: { fr: 'Facture à valider', ar: 'فاتورة في انتظار التحقق' },
      goal: {
        fr: 'Facture proposée à partir d’un import, en attente de confirmation.',
        ar: 'فاتورة مقترحة من الاستيراد، في انتظار التأكيد.'
      },
      related: ['screen.drafts', 'task.import-bank']
    }
  };

  const HELP = { SCREENS, categories: CATEGORIES, articles };

  root.HELP = HELP;
  if (typeof module !== 'undefined' && module.exports) module.exports = HELP;
})(typeof window !== 'undefined' ? window : globalThis);
