package com.example.standbyclockapp.ui.settings

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

@Composable
fun SettingsScreen(
  onBackClick: () -> Unit,
  modifier: Modifier = Modifier
) {
  val context = LocalContext.current
  val sharedPreferences = remember {
    context.getSharedPreferences("standby_clock_settings", Context.MODE_PRIVATE)
  }
  
  val initialInterval = remember {
    sharedPreferences.getInt("switch_interval_seconds", 10)
  }
  
  var intervalSeconds by remember { mutableFloatStateOf(initialInterval.toFloat()) }

  Column(
    modifier = modifier
      .fillMaxSize()
      .background(Color(0xFF07070A))
      .padding(24.dp)
  ) {
    // Header
    Row(
      verticalAlignment = Alignment.CenterVertically,
      modifier = Modifier.fillMaxWidth()
    ) {
      Box(
        modifier = Modifier
          .clip(RoundedCornerShape(12.dp))
          .background(Color(0x1A4B7BEC))
          .border(1.dp, Color(0x334B7BEC), RoundedCornerShape(12.dp))
          .clickable {
            // 保存して戻る
            sharedPreferences.edit().putInt("switch_interval_seconds", intervalSeconds.roundToInt()).apply()
            onBackClick()
          }
          .padding(horizontal = 16.dp, vertical = 8.dp)
      ) {
        Text(
          text = "◀ 戻る",
          color = Color(0xFFA0A5C0),
          fontSize = 16.sp,
          fontWeight = FontWeight.Bold
        )
      }
      
      Spacer(modifier = Modifier.width(16.dp))
      
      Text(
        text = "設定",
        color = Color.White,
        fontSize = 24.sp,
        fontWeight = FontWeight.Bold,
        style = MaterialTheme.typography.titleLarge
      )
    }

    Spacer(modifier = Modifier.height(32.dp))

    // Setting Section Card
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(16.dp))
        .background(Color(0x0DFFFFFF))
        .border(1.dp, Color(0x12FFFFFF), RoundedCornerShape(16.dp))
        .padding(20.dp)
    ) {
      Text(
        text = "画面切り替え設定",
        color = Color(0xFFA0A5C0),
        fontSize = 16.sp,
        fontWeight = FontWeight.Bold
      )
      
      Spacer(modifier = Modifier.height(16.dp))
      
      Text(
        text = "天気とニュースの切り替え間隔",
        color = Color.White,
        fontSize = 14.sp
      )
      
      Spacer(modifier = Modifier.height(8.dp))
      
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        modifier = Modifier.fillMaxWidth()
      ) {
        Slider(
          value = intervalSeconds,
          onValueChange = { intervalSeconds = it },
          valueRange = 5f..60f,
          steps = 10, // 5秒刻み: 5, 10, 15, ..., 60
          modifier = Modifier.weight(1f),
          colors = SliderDefaults.colors(
            activeTrackColor = Color(0xFF4B7BEC),
            inactiveTrackColor = Color(0x334B7BEC),
            thumbColor = Color(0xFF88A3E0)
          )
        )
        
        Spacer(modifier = Modifier.width(16.dp))
        
        Text(
          text = "${intervalSeconds.roundToInt()} 秒",
          color = Color(0xFF4B7BEC),
          fontSize = 20.sp,
          fontWeight = FontWeight.Bold,
          modifier = Modifier.width(70.dp)
        )
      }
      
      Spacer(modifier = Modifier.height(12.dp))
      
      Text(
        text = "右側エリアの天気予報とニュースが、設定された秒数ごとに交互に切り替わります。(設定可能範囲: 5秒〜60秒)",
        color = Color(0x99A0A5C0),
        fontSize = 12.sp,
        lineHeight = 16.sp
      )
    }
  }
}
