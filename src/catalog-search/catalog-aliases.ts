const aliases: Record<
  'program' | 'exercise' | 'muscle',
  Record<string, string[]>
> = {
  muscle: {
    Chest: ['Chest', 'Груди', 'Грудь'],
    Lats: ['Lats', 'Найширші м’язи спини', 'Широчайшие мышцы спины'],
    Quadriceps: ['Quadriceps', 'Квадрицепси', 'Квадрицепсы'],
    Hamstrings: [
      'Hamstrings',
      'Задня поверхня стегна',
      'Задняя поверхность бедра',
    ],
    Deltoids: ['Deltoids', 'Дельтоподібні м’язи', 'Дельтовидные мышцы'],
    Triceps: ['Triceps', 'Трицепси', 'Трицепсы'],
    Biceps: ['Biceps', 'Біцепси', 'Бицепсы'],
    Abs: ['Abs', 'Прес'],
    'Lower Back': ['Lower back', 'Нижня частина спини', 'Нижняя часть спины'],
  },
  exercise: {
    'Barbell Bench Press': [
      'Barbell bench press',
      'Жим штанги лежачи',
      'Жим штанги лёжа',
    ],
    'Incline Dumbbell Press': [
      'Incline dumbbell press',
      'Жим гантелей на похилій лаві',
      'Жим гантелей на наклонной скамье',
    ],
    'Pull-Ups': ['Pull-ups', 'Підтягування', 'Подтягивания'],
    'Lat Pulldown': [
      'Lat pulldown',
      'Тяга верхнього блока',
      'Тяга верхнего блока',
    ],
    'Barbell Back Squat': [
      'Barbell back squat',
      'Присідання зі штангою на спині',
      'Приседания со штангой на спине',
    ],
    'Romanian Deadlift': [
      'Romanian deadlift',
      'Румунська станова тяга',
      'Румынская становая тяга',
    ],
    'Overhead Press': ['Overhead press', 'Жим над головою', 'Жим над головой'],
    'Conventional Deadlift': [
      'Conventional deadlift',
      'Класична станова тяга',
      'Классическая становая тяга',
    ],
    'Bulgarian Split Squat': [
      'Bulgarian split squat',
      'Болгарські спліт-присідання',
      'Болгарские сплит-приседания',
    ],
    'Dumbbell Bicep Curl': [
      'Dumbbell bicep curl',
      'Згинання рук із гантелями на біцепс',
      'Сгибание рук с гантелями на бицепс',
    ],
  },
  program: {
    'HIT Classic Full Body': [
      'HIT classic full body',
      'Класичний HIT на все тіло',
      'Классический HIT на всё тело',
    ],
    'Calendar Demo Program': [
      'Calendar demo program',
      'Демонстраційна календарна програма',
      'Демонстрационная календарная программа',
    ],
    'HIT Full Body': ['HIT full body', 'HIT на все тіло', 'HIT на всё тело'],
    'Upper Body Strength': [
      'Upper body strength',
      'Сила верхньої частини тіла',
      'Сила верхней части тела',
    ],
    'Lower Body & Core': [
      'Lower body & core',
      'Низ тіла та кор',
      'Низ тела и кор',
    ],
  },
};

export function catalogAliases(
  kind: keyof typeof aliases,
  canonicalName: string,
): string[] {
  return aliases[kind][canonicalName] ?? [canonicalName];
}
