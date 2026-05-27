package com.example.standbyclockapp.ui.main

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.view.WindowManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import com.example.standbyclockapp.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import com.example.standbyclockapp.data.DefaultDataRepository
import com.example.standbyclockapp.data.HourlyForecast
import com.example.standbyclockapp.data.DailyForecast
import com.example.standbyclockapp.data.NewsItem
import com.example.standbyclockapp.data.WeatherData
import com.example.standbyclockapp.theme.StandbyClockAppTheme
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class BatteryState(val level: Int, val isCharging: Boolean)

@Composable
fun rememberBatteryState(): BatteryState {
  val context = LocalContext.current
  var batteryState by remember { mutableStateOf(BatteryState(level = 0, isCharging = false)) }

  DisposableEffect(context) {
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val batteryPct = if (scale > 0) (level * 100 / scale.toFloat()) else 0f

        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
          status == BatteryManager.BATTERY_STATUS_FULL

        batteryState = BatteryState(level = batteryPct.toInt(), isCharging = isCharging)
      }
    }
    val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
    context.registerReceiver(receiver, filter)

    onDispose {
      context.unregisterReceiver(receiver)
    }
  }

  return batteryState
}

enum class InfoDisplayType {
  WEATHER, NEWS
}

@SuppressLint("MissingPermission")
@Composable
fun MainScreen(
  onItemClick: (NavKey) -> Unit,
  modifier: Modifier = Modifier,
  context: Context = LocalContext.current,
  viewModel: MainScreenViewModel = viewModel {
    MainScreenViewModel(DefaultDataRepository(context.applicationContext))
  },
) {
  val newsState by viewModel.newsState.collectAsStateWithLifecycle()
  val weatherState by viewModel.weatherState.collectAsStateWithLifecycle()
  val batteryState = rememberBatteryState()

  // Charging: keep screen on
  val activity = context as? Activity
  DisposableEffect(batteryState.isCharging) {
    if (batteryState.isCharging) {
      activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    } else {
      activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    onDispose {
      activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  // Location permissions & tracking
  val permissionLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.RequestMultiplePermissions()
  ) { permissions ->
    val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true
    val coarseGranted = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
    if (fineGranted || coarseGranted) {
      startLocationTracking(context, viewModel)
    }
  }

  LaunchedEffect(Unit) {
    val fineCheck = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
    val coarseCheck = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)

    if (fineCheck == PackageManager.PERMISSION_GRANTED || coarseCheck == PackageManager.PERMISSION_GRANTED) {
      startLocationTracking(context, viewModel)
    } else {
      permissionLauncher.launch(
        arrayOf(
          Manifest.permission.ACCESS_FINE_LOCATION,
          Manifest.permission.ACCESS_COARSE_LOCATION
        )
      )
    }
  }

  // Timer configuration switch
  val sharedPreferences = remember {
    context.getSharedPreferences("standby_clock_settings", Context.MODE_PRIVATE)
  }
  var switchIntervalSeconds by remember {
    mutableStateOf(sharedPreferences.getInt("switch_interval_seconds", 10))
  }

  DisposableEffect(context) {
    val listener = SharedPreferences.OnSharedPreferenceChangeListener { prefs, key ->
      if (key == "switch_interval_seconds") {
        switchIntervalSeconds = prefs.getInt("switch_interval_seconds", 10)
      }
    }
    sharedPreferences.registerOnSharedPreferenceChangeListener(listener)
    onDispose {
      sharedPreferences.unregisterOnSharedPreferenceChangeListener(listener)
    }
  }

  var currentDisplay by remember { mutableStateOf(InfoDisplayType.WEATHER) }
  var currentNewsIndex by remember { mutableStateOf(0) }

  LaunchedEffect(switchIntervalSeconds) {
    while (true) {
      delay(switchIntervalSeconds * 1000L)
      currentDisplay = if (currentDisplay == InfoDisplayType.WEATHER) {
        InfoDisplayType.NEWS
      } else {
        InfoDisplayType.WEATHER
      }
    }
  }

  LaunchedEffect(newsState) {
    while (true) {
      val newsList = (newsState as? NewsUiState.Success)?.news ?: emptyList()
      if (newsList.isNotEmpty()) {
        delay(5000L)
        currentNewsIndex = (currentNewsIndex + 1) % newsList.size
      } else {
        delay(1000L)
      }
    }
  }

  MainDisplay(
    newsState = newsState,
    weatherState = weatherState,
    batteryState = batteryState,
    currentDisplay = currentDisplay,
    currentNewsIndex = currentNewsIndex,
    onSettingsClick = { onItemClick(Settings) },
    modifier = modifier
  )
}


@SuppressLint("MissingPermission")
private fun startLocationTracking(context: Context, viewModel: MainScreenViewModel) {
  val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return
  val hasGps = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
  val hasNetwork = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)

  if (!hasGps && !hasNetwork) return

  var lastKnown: Location? = null
  if (hasNetwork) {
    lastKnown = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
  }
  if (lastKnown == null && hasGps) {
    lastKnown = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
  }
  lastKnown?.let {
    viewModel.updateLocation(it.latitude, it.longitude)
  }

  val listener = object : LocationListener {
    override fun onLocationChanged(location: Location) {
      viewModel.updateLocation(location.latitude, location.longitude)
      locationManager.removeUpdates(this)
    }
  }

  if (hasNetwork) {
    locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0L, 0f, listener)
  } else if (hasGps) {
    locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, listener)
  }
}

@Composable
internal fun MainDisplay(
  newsState: NewsUiState,
  weatherState: WeatherUiState,
  batteryState: BatteryState,
  currentDisplay: InfoDisplayType,
  currentNewsIndex: Int,
  onSettingsClick: () -> Unit,
  modifier: Modifier = Modifier
) {
  Row(
    modifier = Modifier
      .fillMaxSize()
      .background(Color(0xFF07070A)) // OLED friendly deep black-blue
  ) {
    // Left: Clock Area
    Box(
      modifier = Modifier
        .weight(1f)
        .fillMaxHeight(),
      contentAlignment = Alignment.Center
    ) {
      ClockSection(batteryState, onSettingsClick)
    }

    // Divider
    Spacer(
      modifier = Modifier
        .width(1.dp)
        .fillMaxHeight()
        .background(
          Brush.verticalGradient(
            colors = listOf(Color.Transparent, Color(0x334B7BEC), Color.Transparent)
          )
        )
    )

    // Right: Information Area
    Column(
      modifier = Modifier
        .weight(1f)
        .fillMaxHeight()
        .padding(horizontal = 24.dp, vertical = 20.dp)
    ) {
      InformationCard(
        weatherState = weatherState,
        newsState = newsState,
        currentDisplay = currentDisplay,
        currentNewsIndex = currentNewsIndex,
        modifier = Modifier.fillMaxSize()
      )
    }
  }
}

@Composable
fun ClockSection(batteryState: BatteryState, onSettingsClick: () -> Unit) {
  var currentTime by remember { mutableStateOf(System.currentTimeMillis()) }

  LaunchedEffect(Unit) {
    while (true) {
      currentTime = System.currentTimeMillis()
      delay(1000L)
    }
  }

  val timeFormat = remember { SimpleDateFormat("HH:mm", Locale.JAPAN) }
  val secondsFormat = remember { SimpleDateFormat("ss", Locale.JAPAN) }
  val dateFormat = remember { SimpleDateFormat("M月d日(E)", Locale.JAPAN) }
  val date = Date(currentTime)

  Column(
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center
  ) {
    // Date
    Text(
      text = dateFormat.format(date),
      color = Color(0xFFA0A5C0),
      fontSize = 24.sp,
      fontWeight = FontWeight.Medium,
      letterSpacing = 1.sp
    )

    Spacer(modifier = Modifier.height(8.dp))

    // Time (HH:mm:ss)
    Row(
      verticalAlignment = Alignment.Bottom
    ) {
      Text(
        text = timeFormat.format(date),
        fontSize = 80.sp,
        fontWeight = FontWeight.Bold,
        // Gradient text style
        style = MaterialTheme.typography.displayLarge.copy(
          brush = Brush.linearGradient(
            colors = listOf(Color(0xFFE0E6ED), Color(0xFF88A3E0))
          )
        )
      )
      Spacer(modifier = Modifier.width(4.dp))
      Text(
        text = secondsFormat.format(date),
        fontSize = 28.sp,
        color = Color(0x9988A3E0),
        fontWeight = FontWeight.Medium,
        modifier = Modifier.padding(bottom = 12.dp)
      )
    }

    Spacer(modifier = Modifier.height(16.dp))

    // Charging indicator & Battery pct
    Row(
      verticalAlignment = Alignment.CenterVertically,
      modifier = Modifier
        .clip(RoundedCornerShape(12.dp))
        .background(Color(0x1A4B7BEC))
        .border(1.dp, Color(0x334B7BEC), RoundedCornerShape(12.dp))
        .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
      val batteryText = if (batteryState.isCharging) {
        "⚡ 充電中: ${batteryState.level}%"
      } else {
        "🔋 バッテリー: ${batteryState.level}%"
      }
      Text(
        text = batteryText,
        color = if (batteryState.isCharging) Color(0xFF4cd137) else Color(0xFFA0A5C0),
        fontSize = 14.sp,
        fontWeight = FontWeight.SemiBold
      )
    }

    Spacer(modifier = Modifier.height(16.dp))

    // Settings Button
    Box(
      modifier = Modifier
        .clip(RoundedCornerShape(12.dp))
        .background(Color(0x0AFFFFFF))
        .border(1.dp, Color(0x1AFFFFFF), RoundedCornerShape(12.dp))
        .clickable { onSettingsClick() }
        .padding(horizontal = 16.dp, vertical = 8.dp)
    ) {
      Text(
        text = "⚙️ 設定",
        color = Color(0xFFA0A5C0),
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium
      )
    }
  }
}

@Composable
fun InformationCard(
  weatherState: WeatherUiState,
  newsState: NewsUiState,
  currentDisplay: InfoDisplayType,
  currentNewsIndex: Int,
  modifier: Modifier = Modifier
) {
  Box(
    modifier = modifier
      .clip(RoundedCornerShape(16.dp))
      .background(Color(0x0DFFFFFF))
      .border(1.dp, Color(0x12FFFFFF), RoundedCornerShape(16.dp))
      .padding(16.dp)
  ) {
    AnimatedContent(
      targetState = currentDisplay,
      transitionSpec = {
        fadeIn() togetherWith fadeOut()
      },
      label = "infoSwitchAnimation",
      modifier = Modifier.fillMaxSize()
    ) { displayType ->
      when (displayType) {
        InfoDisplayType.WEATHER -> {
          WeatherDetailsView(weatherState = weatherState)
        }
        InfoDisplayType.NEWS -> {
          NewsDetailsView(newsState = newsState, currentIndex = currentNewsIndex)
        }
      }
    }
  }
}

@Composable
fun WeatherDetailsView(weatherState: WeatherUiState) {
  Column(
    modifier = Modifier.fillMaxSize(),
    verticalArrangement = Arrangement.SpaceBetween
  ) {
    Text(
      text = "天気予報",
      color = Color(0x99FFFFFF),
      fontSize = 12.sp,
      fontWeight = FontWeight.Bold,
      letterSpacing = 1.sp
    )

    when (weatherState) {
      is WeatherUiState.Loading -> {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          CircularProgressIndicator(color = Color(0xFF4B7BEC))
        }
      }
      is WeatherUiState.Success -> {
        val weather = weatherState.weather
        val (emoji, desc) = getWeatherEmojiAndText(weather.weatherCode)

        Column(
          modifier = Modifier.weight(1f),
          verticalArrangement = Arrangement.SpaceEvenly
        ) {
          // Current Weather
          Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
          ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
              Text(
                text = emoji,
                fontSize = 44.sp,
                modifier = Modifier.padding(end = 12.dp)
              )
              Column {
                Text(
                  text = weather.location,
                  color = Color.White,
                  fontSize = 20.sp,
                  fontWeight = FontWeight.Bold
                )
                Text(
                  text = desc,
                  color = Color(0xFFA0A5C0),
                  fontSize = 13.sp
                )
              }
            }
            Column(horizontalAlignment = Alignment.End) {
              Text(
                text = "${weather.temperature}°C",
                color = Color(0xFF4B7BEC),
                fontSize = 28.sp,
                fontWeight = FontWeight.ExtraBold,
                style = MaterialTheme.typography.titleLarge.copy(
                  brush = Brush.linearGradient(
                    colors = listOf(Color(0xFF88A3E0), Color(0xFF4B7BEC))
                  )
                )
              )
              Text(
                text = "降水確率: ${weather.precipitationProbability}%",
                color = Color(0xFF45AAF2),
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold
              )
            }
          }

          Spacer(modifier = Modifier.height(8.dp))

          // Forecast Area
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
          ) {
            // Left: Hourly Forecast (4 hours)
            if (weather.hourlyForecasts.isNotEmpty()) {
              Column(
                modifier = Modifier
                  .weight(1.2f)
                  .clip(RoundedCornerShape(12.dp))
                  .background(Color(0x05FFFFFF))
                  .padding(10.dp)
              ) {
                Text(
                  text = "時間別予報",
                  color = Color(0x80FFFFFF),
                  fontSize = 11.sp,
                  fontWeight = FontWeight.Bold,
                  modifier = Modifier.padding(bottom = 6.dp)
                )
                weather.hourlyForecasts.take(4).forEach { hourly ->
                  val (hEmoji, _) = getWeatherEmojiAndText(hourly.weatherCode)
                  Row(
                    modifier = Modifier
                      .fillMaxWidth()
                      .padding(vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically
                  ) {
                    Text(
                      text = hourly.time,
                      color = Color(0xFFA0A5C0),
                      fontSize = 11.sp,
                      modifier = Modifier.width(36.dp)
                    )
                    Text(
                      text = hEmoji,
                      fontSize = 14.sp,
                      modifier = Modifier.padding(horizontal = 4.dp)
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    Text(
                      text = "${hourly.temperature}°",
                      color = Color.White,
                      fontSize = 11.sp,
                      fontWeight = FontWeight.Medium
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                      text = "${hourly.precipitationProbability}%",
                      color = Color(0xFF45AAF2),
                      fontSize = 11.sp,
                      modifier = Modifier.width(30.dp),
                      textAlign = TextAlign.End
                    )
                  }
                }
              }
            }

            // Right: Daily Forecast (4 days)
            if (weather.dailyForecasts.isNotEmpty()) {
              Column(
                modifier = Modifier
                  .weight(0.8f)
                  .clip(RoundedCornerShape(12.dp))
                  .background(Color(0x05FFFFFF))
                  .padding(10.dp)
              ) {
                Text(
                  text = "週間予報",
                  color = Color(0x80FFFFFF),
                  fontSize = 11.sp,
                  fontWeight = FontWeight.Bold,
                  modifier = Modifier.padding(bottom = 6.dp)
                )
                weather.dailyForecasts.take(4).forEach { daily ->
                  val (dEmoji, _) = getWeatherEmojiAndText(daily.weatherCode)
                  Row(
                    modifier = Modifier
                      .fillMaxWidth()
                      .padding(vertical = 3.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                  ) {
                    Text(
                      text = daily.date,
                      color = Color(0xFFA0A5C0),
                      fontSize = 11.sp,
                      modifier = Modifier.width(20.dp)
                    )
                    Text(
                      text = dEmoji,
                      fontSize = 14.sp
                    )
                    Text(
                      text = "${daily.maxTemp}°/${daily.minTemp}°",
                      color = Color.White,
                      fontSize = 11.sp,
                      textAlign = TextAlign.End,
                      modifier = Modifier.weight(1f)
                    )
                  }
                }
              }
            }
          }
        }
      }
      is WeatherUiState.Error -> {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          Text(
            text = "天気の取得に失敗しました",
            color = Color(0xFFFF4D4D),
            fontSize = 14.sp
          )
        }
      }
    }
  }
}

@Composable
fun NewsDetailsView(newsState: NewsUiState, currentIndex: Int) {
  Column(
    modifier = Modifier.fillMaxSize(),
    verticalArrangement = Arrangement.Top
  ) {
    Text(
      text = "最新ニュース",
      color = Color(0x99FFFFFF),
      fontSize = 12.sp,
      fontWeight = FontWeight.Bold,
      letterSpacing = 1.sp
    )

    Spacer(modifier = Modifier.height(12.dp))

    when (newsState) {
      is NewsUiState.Loading -> {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          CircularProgressIndicator(color = Color(0xFF4B7BEC))
        }
      }
      is NewsUiState.Success -> {
        val newsList = newsState.news
        if (newsList.isNotEmpty()) {
          val safeIndex = currentIndex % newsList.size
          val currentNews = newsList[safeIndex]
          
          AnimatedContent(
            targetState = currentNews,
            transitionSpec = {
              fadeIn() togetherWith fadeOut()
            },
            label = "newsItemTransition",
            modifier = Modifier.weight(1f)
          ) { item ->
            Column(
              modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(12.dp))
                .background(Color(0x0AFFFFFF))
                .border(1.dp, Color(0x15FFFFFF), RoundedCornerShape(12.dp))
                .padding(16.dp),
              verticalArrangement = Arrangement.Top
            ) {
              // Title
              Text(
                text = item.title,
                color = Color.White,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                lineHeight = 24.sp,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
              )

              Spacer(modifier = Modifier.height(10.dp))

              // PubDate & Indicator
              Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
              ) {
                if (item.pubDate.isNotEmpty()) {
                  Text(
                    text = item.pubDate,
                    color = Color(0x80A0A5C0),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium
                  )
                }
                
                Text(
                  text = "${safeIndex + 1} / ${newsList.size}",
                  color = Color(0x66A0A5C0),
                  fontSize = 10.sp,
                  fontWeight = FontWeight.Bold
                )
              }

              Spacer(modifier = Modifier.height(12.dp))

              // Description (Detailed content)
              val descText = item.description.ifEmpty { "詳細な概要はありません。" }
              Text(
                text = descText,
                color = Color(0xFFD1D8E0),
                fontSize = 13.sp,
                lineHeight = 18.sp,
                maxLines = 5,
                overflow = TextOverflow.Ellipsis
              )
            }
          }
        } else {
          Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(
              text = "ニュースがありません",
              color = Color.White,
              fontSize = 14.sp
            )
          }
        }
      }
      is NewsUiState.Error -> {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          Text(
            text = "ニュースの取得に失敗しました",
            color = Color(0xFFFF4D4D),
            fontSize = 14.sp
          )
        }
      }
    }
  }
}


fun getWeatherEmojiAndText(code: Int): Pair<String, String> {
  return when (code) {
    0 -> "☀️" to "快晴"
    1, 2, 3 -> "🌤️" to "晴れ/曇り"
    45, 48 -> "🌫️" to "霧"
    51, 53, 55 -> "🌧️" to "霧雨"
    61, 63, 65 -> "☔" to "雨"
    71, 73, 75 -> "❄️" to "雪"
    80, 81, 82 -> "🌦️" to "にわか雨"
    95, 96, 99 -> "⛈️" to "雷雨"
    else -> "❓" to "不明"
  }
}

@Preview(showBackground = true, widthDp = 800, heightDp = 360)
@Composable
fun MainDisplayPreview() {
  StandbyClockAppTheme {
    MainDisplay(
      newsState = NewsUiState.Success(
        listOf(
          NewsItem("全国で真夏日を観測 熱中症に警戒が必要です", "", "5/21 15:30", "気象庁は全国の多くの地域で今年初めての真夏日を観測したと発表しました。明日以降も気温が高い状態が続く見込みで、こまめな水分補給やエアコンの適切な使用など、熱中症への警戒を呼びかけています。"),
          NewsItem("最新の経済指標が発表 市場の反応は限定的", "", "5/21 16:00", "本日発表された最新の経済指標について、市場関係者は予想の範囲内との受け止めを示しており、東京株式市場への影響は限定的でした。")
        )
      ),
      weatherState = WeatherUiState.Success(
        WeatherData(
          temperature = 24.5,
          weatherCode = 1,
          location = "東京",
          precipitationProbability = 20,
          hourlyForecasts = listOf(
            HourlyForecast("22:00", 23.0, 1, 10),
            HourlyForecast("23:00", 22.0, 3, 30),
            HourlyForecast("00:00", 21.0, 61, 60)
          ),
          dailyForecasts = listOf(
            DailyForecast("金", 26.0, 18.0, 1),
            DailyForecast("土", 25.0, 17.0, 3),
            DailyForecast("日", 22.0, 16.0, 61)
          )
        )
      ),
      batteryState = BatteryState(80, true),
      currentDisplay = InfoDisplayType.WEATHER,
      currentNewsIndex = 0,
      onSettingsClick = {}
    )
  }
}

